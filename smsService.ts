import crypto from 'crypto';

interface SmsCode {
  code: string;
  expiresAt: number;
  verified: boolean;
}

const smsCodeStore = new Map<string, SmsCode>();
const SMS_CODE_TTL = 3 * 60 * 60 * 1000;
const ALIYUN_SMS_ENDPOINT = 'https://dysmsapi.aliyuncs.com';

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/\+/g, '%2B')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

function generateSignature(stringToSign: string, secret: string): string {
  return crypto.createHmac('sha1', secret + '&').update(stringToSign).digest('base64');
}

export async function sendSmsCode(phone: string): Promise<{ success: boolean; message: string; code?: string }> {
  try {
    const accessKeyId = process.env.ALIBABA_ACCESS_KEY_ID!;
    const accessKeySecret = process.env.ALIBABA_ACCESS_KEY_SECRET!;
    const signName = process.env.ALIBABA_SMS_SIGN_NAME!;
    const templateCode = process.env.ALIBABA_SMS_TEMPLATE_CODE!;

    if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
      return { success: false, message: '短信配置不完整，请检查环境变量' };
    }

    const existing = smsCodeStore.get(phone);
    if (existing && existing.expiresAt > Date.now() && !existing.verified) {
      const remaining = Math.ceil((existing.expiresAt - Date.now()) / 1000);
      if (remaining > 60) {
        return { success: false, message: `请 ${remaining} 秒后再试` };
      }
    }

    const code = generateCode();
    const timestamp = new Date().toISOString().replace(/[:\-]T/g, '').split('.')[0] + 'Z';
    const randomStr = Math.random().toString(36).substring(2, 12);

    const sortedParams: Record<string, string> = {
      AccessKeyId: accessKeyId,
      Action: 'SendSms',
      Version: '2017-05-25',
      Format: 'JSON',
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: randomStr,
      Timestamp: timestamp,
      PhoneNumbers: phone,
      SignName: signName,
      TemplateCode: templateCode,
      TemplateParam: JSON.stringify({ code }),
    };

    const canonicalizedQueryString = Object.keys(sortedParams)
      .sort()
      .map(k => `${percentEncode(k)}=${percentEncode(sortedParams[k])}`)
      .join('&');

    const stringToSign = `POST&%2F&${percentEncode(canonicalizedQueryString)}`;
    const signature = generateSignature(stringToSign, accessKeySecret);

    const queryString = `${canonicalizedQueryString}&Signature=${percentEncode(signature)}`;
    const fullUrl = `${ALIYUN_SMS_ENDPOINT}/?${queryString}`;

    console.log('[SMS] 发送请求:', fullUrl.substring(0, 100));
    const response = await fetch(fullUrl, { method: 'POST' });
    const data = await response.json() as any;

    console.log('[SMS] 阿里云返回:', JSON.stringify(data));

    if (data.Code === 'OK') {
      smsCodeStore.set(phone, { code, expiresAt: Date.now() + SMS_CODE_TTL, verified: false });
      console.log(`[SMS] 验证码已发送至 ${phone}，验证码: ${code}`);
      return { success: true, message: '验证码已发送', code: process.env.NODE_ENV === 'development' ? code : undefined };
    } else {
      return { success: false, message: data.Message || '发送失败' };
    }
  } catch (error: any) {
    console.error('[SMS] 发送异常:', error.message);
    return { success: false, message: error.message || '发送异常' };
  }
}

export function verifySmsCode(phone: string, code: string): { success: boolean; message: string } {
  const record = smsCodeStore.get(phone);
  if (!record) return { success: false, message: '请先获取验证码' };
  if (record.expiresAt < Date.now()) { smsCodeStore.delete(phone); return { success: false, message: '验证码已过期，请重新获取' }; }
  if (record.verified) return { success: false, message: '验证码已使用，请重新获取' };
  if (record.code !== code) return { success: false, message: '验证码错误' };
  record.verified = true;
  smsCodeStore.set(phone, record);
  return { success: true, message: '验证成功' };
}

setInterval(() => {
  const now = Date.now();
  for (const [phone, record] of smsCodeStore.entries()) {
    if (record.expiresAt < now) smsCodeStore.delete(phone);
  }
}, 5 * 60 * 1000);
