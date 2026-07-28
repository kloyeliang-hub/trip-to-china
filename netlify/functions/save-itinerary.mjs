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
        {
          error: "Missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO."
        },
        { status: 500 }
      );
    }

    const body = await req.json();

    if (!body?.days || !Array.isArray(body.days)) {
      return Response.json(
        { error: "Invalid itinerary JSON." },
        { status: 400 }
      );
    }

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
      return Response.json(
        { error: `GitHub ref read failed: ${refRes.status}` },
        { status: 502 }
      );
    }

    const ref = await refRes.json();
    const parentCommitSha = ref.object.sha;

    const commitRes = await fetch(
      `${apiBase}/git/commits/${parentCommitSha}`,
      { headers }
    );

    if (!commitRes.ok) {
      return Response.json(
        { error: `GitHub commit read failed: ${commitRes.status}` },
        { status: 502 }
      );
    }

    const parentCommit = await commitRes.json();
    const baseTreeSha = parentCommit.tree.sha;

    const next = structuredClone(body);
    const treeEntries = [];

    let uploadedImages = 0;
    const stamp = Date.now();

    for (let di = 0; di < next.days.length; di++) {
      const day = next.days[di];

      if (!Array.isArray(day.stops)) {
        continue;
      }

      for (let si = 0; si < day.stops.length; si++) {
        const stop = day.stops[si];

        if (!Array.isArray(stop.images)) {
          stop.images = [];
        }

        stop.images = stop.images.slice(0, 2);

        for (let ii = 0; ii < stop.images.length; ii++) {
          const value = stop.images[ii];

          if (
            typeof value !== "string" ||
            !value.startsWith("data:image/")
          ) {
            continue;
          }

          const match = value.match(
            /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/
          );

          if (!match) {
            return Response.json(
              {
                error:
                  `Unsupported image format at day ${di + 1}, stop ${si + 1}.`
              },
              { status: 400 }
            );
          }

          const mime = match[1];
          const base64 = match[2];

          let ext = "jpg";

          if (mime === "image/png") {
            ext = "png";
          } else if (mime === "image/webp") {
            ext = "webp";
          } else if (mime === "image/gif") {
            ext = "gif";
          }

          const slug =
            String(stop.zh || `stop-${si + 1}`)
              .normalize("NFKD")
              .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 36) ||
            `stop-${si + 1}`;

          const path =
            `assets/images/` +
            `${stamp}-d${di + 1}` +
            `-s${si + 1}` +
            `-i${ii + 1}` +
            `-${slug}.${ext}`;

          const blobRes = await fetch(
            `${apiBase}/git/blobs`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                content: base64,
                encoding: "base64"
              })
            }
          );

          if (!blobRes.ok) {
            const detail = await blobRes.text();

            return Response.json(
              {
                error:
                  `GitHub image blob failed: ` +
                  `${blobRes.status} ${detail}`
              },
              { status: 502 }
            );
          }

          const blob = await blobRes.json();

          treeEntries.push({
            path,
            mode: "100644",
            type: "blob",
            sha: blob.sha
          });

          stop.images[ii] = `/${path}`;
          uploadedImages++;
        }

        while (
          stop.images.length &&
          !stop.images[stop.images.length - 1]
        ) {
          stop.images.pop();
        }
      }
    }

    const json =
      JSON.stringify(next, null, 2) + "\n";

    const jsonBlobRes = await fetch(
      `${apiBase}/git/blobs`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          content:
            Buffer
              .from(json, "utf8")
              .toString("base64"),

          encoding: "base64"
        })
      }
    );

    if (!jsonBlobRes.ok) {
      const detail = await jsonBlobRes.text();

      return Response.json(
        {
          error:
            `GitHub JSON blob failed: ` +
            `${jsonBlobRes.status} ${detail}`
        },
        { status: 502 }
      );
    }

    const jsonBlob = await jsonBlobRes.json();

    treeEntries.push({
      path: "data/itinerary.json",
      mode: "100644",
      type: "blob",
      sha: jsonBlob.sha
    });

    const treeRes = await fetch(
      `${apiBase}/git/trees`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeEntries
        })
      }
    );

    if (!treeRes.ok) {
      const detail = await treeRes.text();

      return Response.json(
        {
          error:
            `GitHub tree creation failed: ` +
            `${treeRes.status} ${detail}`
        },
        { status: 502 }
      );
    }

    const tree = await treeRes.json();

    const newCommitRes = await fetch(
      `${apiBase}/git/commits`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          message:
            uploadedImages
              ? `Update Beijing itinerary and upload ${uploadedImages} image(s)`
              : "Update Beijing itinerary from visual editor",

          tree: tree.sha,

          parents: [
            parentCommitSha
          ]
        })
      }
    );

    if (!newCommitRes.ok) {
      const detail = await newCommitRes.text();

      return Response.json(
        {
          error:
            `GitHub commit creation failed: ` +
            `${newCommitRes.status} ${detail}`
        },
        { status: 502 }
      );
    }

    const newCommit =
      await newCommitRes.json();

    const updateRefRes = await fetch(
      `${apiBase}/git/refs/heads/${encodeURIComponent(branch)}`,
      {
        method: "PATCH",
        headers,

        body: JSON.stringify({
          sha: newCommit.sha,
          force: false
        })
      }
    );

    if (!updateRefRes.ok) {
      const detail =
        await updateRefRes.text();

      return Response.json(
        {
          error:
            `GitHub branch update failed: ` +
            `${updateRefRes.status} ${detail}`
        },
        { status: 502 }
      );
    }

    return Response.json({
      ok: true,
      commit: newCommit.sha,
      uploadedImages,
      itinerary: next
    });

  } catch (error) {
    console.error(error);

    return Response.json(
      {
        error:
          error?.message ||
          "Unexpected server error."
      },
      { status: 500 }
    );
  }
};
