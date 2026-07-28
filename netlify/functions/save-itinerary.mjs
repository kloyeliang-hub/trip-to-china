export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || "main";
    const adminKey = process.env.ADMIN_KEY;

    if (!token || !owner || !repo) {
      return Response.json({ error: "Missing GitHub environment variables." }, { status: 500 });
    }

    // Optional shared secret. If ADMIN_KEY is configured, the editor must send it.
    if (adminKey && req.headers.get("x-admin-key") !== adminKey) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    if (!body?.days || !Array.isArray(body.days)) {
      return Response.json({ error: "Invalid itinerary JSON." }, { status: 400 });
    }

    const path = "data/itinerary.json";
    const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const current = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!current.ok) {
      return Response.json({ error: `GitHub read failed: ${current.status}` }, { status: 502 });
    }

    const file = await current.json();
    const json = JSON.stringify(body, null, 2) + "\n";
    const content = Buffer.from(json, "utf8").toString("base64");

    const saved = await fetch(api, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({
        message: "Update Beijing itinerary from visual editor",
        content,
        sha: file.sha,
        branch
      })
    });

    const result = await saved.json();
    if (!saved.ok) {
      return Response.json({ error: result?.message || `GitHub save failed: ${saved.status}` }, { status: 502 });
    }

    return Response.json({ ok: true, commit: result.commit?.sha });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
};