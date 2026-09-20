(() => {
  "use strict";

  const selfScript = document.currentScript;
  let version = "";
  try {
    version =
      new URL(selfScript.src, document.baseURI)
        .searchParams.get("v") || "";
  } catch (_) {}

  const q = version
    ? `?v=${encodeURIComponent(version)}`
    : "";

  function fail(error) {
    console.error(error);
    document.body.innerHTML =
      "<pre style='padding:20px;font:14px monospace'>" +
      "Netherlands railway data could not be loaded.\\n" +
      String(error?.message || error) +
      "</pre>";
  }

  function decodeBase64Part(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }

  try {
    const encodedParts = window.__NL_DATA_B64 || [];

    if (!encodedParts.length) {
      throw new Error(
        "No Netherlands data chunks were loaded."
      );
    }

    const decodedParts = [];
    let totalBytes = 0;

    for (const encoded of encodedParts) {
      if (typeof encoded !== "string" || !encoded.length) {
        throw new Error(
          "One or more Netherlands data chunks are missing."
        );
      }

      const part = decodeBase64Part(encoded);
      decodedParts.push(part);
      totalBytes += part.byteLength;
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;

    for (const part of decodedParts) {
      combined.set(part, offset);
      offset += part.byteLength;
    }

    const text = new TextDecoder("utf-8").decode(combined);
    window.NL_DOMESTIC_DATA = JSON.parse(text);

    // Release the Base64 strings after reconstruction.
    try {
      delete window.__NL_DATA_B64;
    } catch (_) {
      window.__NL_DATA_B64 = null;
    }

    const app = document.createElement("script");
    app.src = `app.js${q}`;
    app.onerror = () =>
      fail(new Error("app.js could not be loaded."));
    document.body.appendChild(app);

  } catch (error) {
    fail(error);
  }
})();
