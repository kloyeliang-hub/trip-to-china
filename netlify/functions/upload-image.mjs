export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || "main";

    if (!token || !owner || !repo) {
      return Response.json(
        { error: "Missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const match = String(body?.image || "").match(
      /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/
    );

    if (!match) {
      return Response.json(
        { error: "Unsupported or missing image." },
        { status: 400 }
      );
    }

    const mime = match[1];
    const base64 = match[2];
    const day = Math.max(1, Number(body.day) || 1);
    const stop = Math.max(1, Number(body.stop) || 1);
    const slot = Math.max(1, Number(body.slot) || 1);
    const ext = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif"
    }[mime];
    const slug =
      String(body.name || `stop-${stop}`)
        .normalize("NFKD")
        .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 36) || `stop-${stop}`;
    const path =
      `assets/images/${Date.now()}-d${day}-s${stop}-i${slot}-${slug}.${ext}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

    const refRes = await fetch(
      `${apiBase}/git/ref/heads/${encodeURIComponent(branch)}`,
      { headers }
    );
    if (!refRes.ok) {
      return githubError("GitHub ref read failed", refRes);
    }
    const ref = await refRes.json();
    const parentCommitSha = ref.object.sha;

    const commitRes = await fetch(
      `${apiBase}/git/commits/${parentCommitSha}`,
      { headers }
    );
    if (!commitRes.ok) {
      return githubError("GitHub commit read failed", commitRes);
    }
    const parentCommit = await commitRes.json();

    const blobRes = await fetch(`${apiBase}/git/blobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: base64, encoding: "base64" })
    });
    if (!blobRes.ok) {
      return githubError("GitHub image blob failed", blobRes);
    }
    const blob = await blobRes.json();

    const treeRes = await fetch(`${apiBase}/git/trees`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        base_tree: parentCommit.tree.sha,
        tree: [{ path, mode: "100644", type: "blob", sha: blob.sha }]
      })
    });
    if (!treeRes.ok) {
      return githubError("GitHub image tree failed", treeRes);
    }
    const tree = await treeRes.json();

    const newCommitRes = await fetch(`${apiBase}/git/commits`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: `Upload itinerary image for ${slug}`,
        tree: tree.sha,
        parents: [parentCommitSha]
      })
    });
    if (!newCommitRes.ok) {
      return githubError("GitHub image commit failed", newCommitRes);
    }
    const newCommit = await newCommitRes.json();

    const updateRefRes = await fetch(
      `${apiBase}/git/refs/heads/${encodeURIComponent(branch)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sha: newCommit.sha, force: false })
      }
    );
    if (!updateRefRes.ok) {
      return githubError("GitHub image branch update failed", updateRefRes);
    }

    return Response.json({
      ok: true,
      path: `/${path}`,
      commit: newCommit.sha
    });
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: error?.message || "Unexpected image upload error." },
      { status: 500 }
    );
  }
};

async function githubError(label, response) {
  const detail = await response.text();
  return Response.json(
    { error: `${label}: ${response.status} ${detail}` },
    { status: 502 }
  );
}
