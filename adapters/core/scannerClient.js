import http from "node:http";

function postLocalJSON(pathname, body = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: 5057, path: pathname, method: "POST",
        headers: { "Content-Type": "application/json" } },
      (res) => {
        let b = ""; res.on("data", c => b += c);
        res.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch (e) { reject(e); } });
      }
    );
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

export async function scanJobs() { return postLocalJSON("/scan_jobs"); }
export async function scanSubscriptions() { return postLocalJSON("/scan_subscriptions"); }
