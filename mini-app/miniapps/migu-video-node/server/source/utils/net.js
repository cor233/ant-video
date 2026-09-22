import os from "os"
import { printRed } from "./colorOut.js";

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function getLocalIPv(ver = 4) {
  const ips = []
  const inter = os.networkInterfaces()
  for (let net in inter) {
    for (let netPort of inter[net]) {
      if (netPort.family === `IPv${ver}`) {
        ips.push(netPort.address)
      }
    }
  }
  return ips
}

async function fetchUrl(url, opts = {}, timeout = 6000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort()
    printRed("请求超时")
  }, timeout);
  try {
    const res = await fetch(url, {
      ...opts,
      headers: {
        "User-Agent": MOBILE_UA,
        ...(opts.headers || {}),
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return await res.json();
  } catch (err) {
    console.error("请求失败:", err);
    clearTimeout(timeoutId);
    return null;
  }
}

export {
  getLocalIPv, fetchUrl
}
