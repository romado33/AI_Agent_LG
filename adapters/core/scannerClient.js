import http from "node:http";

const SCANNER_HOST = "127.0.0.1";
const SCANNER_PORT = 5057;

function postLocalJSON(pathname, body = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: SCANNER_HOST,
        port: SCANNER_PORT,
        path: pathname,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(b || "{}"));
          } catch (e) {
            reject(new Error(`Failed to parse scanner response: ${e.message}`));
          }
        });
      }
    );
    req.on("error", (err) => {
      reject(new Error(`Scanner request failed: ${err.message}`));
    });
    req.write(JSON.stringify(body));
    req.end();
  });
}

export async function scanJobs() {
  return postLocalJSON("/scan_jobs");
}

export async function scanSubscriptions() {
  return postLocalJSON("/scan_subscriptions");
}
