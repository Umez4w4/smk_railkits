(() => {
  "use strict";

  const CURRENT_CODE = "nl";
  const REGISTRY_URL = "../../config/countries.json";

  function toolkitRoot() {
    return new URL("../../", document.baseURI);
  }

  function targetURL(country) {
    const root = toolkitRoot();
    const path = country.app_path || "index.html";
    const url = new URL(path, root);
    url.searchParams.set("country", country.code);
    return url;
  }

  async function installToolkitCountrySwitch() {
    try {
      const response = await fetch(REGISTRY_URL, {cache: "no-store"});
      if (!response.ok) {
        throw new Error(`countries.json ${response.status}`);
      }

      const registry = await response.json();
      const released = (registry.countries || []).filter(
        c => c && c.released === true
      );

      if (released.length <= 1) return;

      const host = document.createElement("div");
      host.id = "toolkitCountryHost";
      host.className = "toolkit-country-host";

      const label = document.createElement("span");
      label.textContent = "Country";

      const select = document.createElement("select");
      select.setAttribute("aria-label", "Country");

      for (const country of released) {
        const option = document.createElement("option");
        option.value = country.code;
        option.textContent =
          country.label || country.name_en || country.code;
        option.selected = country.code === CURRENT_CODE;
        select.appendChild(option);
      }

      select.addEventListener("change", () => {
        const country = released.find(c => c.code === select.value);
        if (!country) return;

        localStorage.setItem("rail_country", country.code);
        window.location.href = targetURL(country).toString();
      });

      host.append(label, select);
      document.body.appendChild(host);

      localStorage.setItem("rail_country", CURRENT_CODE);

    } catch (error) {
      console.warn("Toolkit country switch unavailable:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      installToolkitCountrySwitch,
      {once: true}
    );
  } else {
    installToolkitCountrySwitch();
  }
})();
