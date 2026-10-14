import CryptoJS from '../vendor/crypto-es.mjs';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const IV = '0102030405060708';
const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const RSA_MODULUS = BigInt(
  '0x00e0b509687ced76546702928393559386373f97f4bd87010e86e9dc5e9420045ad356246d589f2b55255718489024626d0b2818510a7183371fd1fa5e5c2060680fb1d6a5174550377bac929486b66f7a7227885f85b8e167659a1743a663c1a7fb332f5806759d15b88184a5121634ce09b46fd570bad5bf9d9bc304698a4db447f08e2249884cbba5a84a663b2727764bf15c67832fa85795262b2ff6f7a2c5300c2b74cc3300a5e587265bfa30fe2c4d7772ef64e174c486bb9631a5880a7fa5ae9f9e8a40b532b2963d4ffe1e1',
);
const RSA_EXP = BigInt(65537);

function modPow(base, exp, mod) {
  let result = BigInt(1);
  let b = base % mod;
  let e = exp;
  while (e > BigInt(0)) {
    if (e % BigInt(2) === BigInt(1)) result = (result * b) % mod;
    b = (b * b) % mod;
    e /= BigInt(2);
  }
  return result;
}

function rsaEncrypt(text) {
  const reversed = String(text || '').split('').reverse().join('');
  let x = BigInt(0);
  for (let i = 0; i < reversed.length; i++) {
    x = (x << BigInt(8)) + BigInt(reversed.charCodeAt(i));
  }
  const y = modPow(x, RSA_EXP, RSA_MODULUS);
  return y.toString(16).padStart(256, '0');
}

function aesEncrypt(text, key, iv) {
  return CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(text),
    CryptoJS.enc.Utf8.parse(key),
    {
      iv: CryptoJS.enc.Utf8.parse(iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    },
  ).toString();
}

export function weapiEncrypt(object) {
  const text = JSON.stringify(object || {});
  let secretKey = '';
  for (let i = 0; i < 16; i++) secretKey += BASE62.charAt(Math.floor(Math.random() * BASE62.length));
  return {
    params: aesEncrypt(aesEncrypt(text, PRESET_KEY, IV), secretKey, IV),
    encSecKey: rsaEncrypt(secretKey),
  };
}

export async function weapiRequest(path, data, cookieHeader) {
  const apiPath = String(path || '').replace(/^\/+/, '').replace(/^weapi\//, '').replace(/^api\//, '');
  const encrypted = weapiEncrypt(data || {});
  const resp = await fetch(`https://music.163.com/weapi/${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      Referer: 'https://music.163.com/',
      Cookie: cookieHeader || '',
    },
    body: new URLSearchParams(encrypted).toString(),
  });
  try {
    return await resp.json();
  } catch (_) {
    return {};
  }
}
