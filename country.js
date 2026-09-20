(() => {
  "use strict";

  const RAIL_COUNTRY_HELPER_VERSION = "2026-09-20-v44";

  let bootstrapPromise = null;

  function requestedCode() {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("country") ||
      localStorage.getItem("rail_country") ||
      ""
    ).trim().toLowerCase();
  }

  function rootTargetURL(country) {
    const path = country.app_path || "index.html";
    const url = new URL(path, document.baseURI);
    url.searchParams.set("country", country.code);
    return url;
  }

  function buildSelector(released, current) {
    const host = document.getElementById("countrySwitchHost");
    if (!host) return;

    if (released.length <= 1) {
      host.hidden = true;
      return;
    }

    const select = document.createElement("select");
    select.id = "countrySwitch";
    select.setAttribute("aria-label", "Country / 国");

    for (const country of released) {
      const option = document.createElement("option");
      option.value = country.code;
      option.textContent =
        country.label || country.name_en || country.code;
      option.selected = country.code === current.code;
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      const next = released.find(c => c.code === select.value);
      if (!next) return;

      localStorage.setItem("rail_country", next.code);

      if ((next.app_path || "index.html") !== "index.html") {
        window.location.href = rootTargetURL(next).toString();
        return;
      }

      const url = new URL(window.location.href);
      url.searchParams.set("country", next.code);
      window.location.href = url.toString();
    });

    host.replaceChildren(select);
    host.hidden = false;
  }

  async function bootstrapCountry() {
    if (bootstrapPromise) return bootstrapPromise;

    bootstrapPromise = (async () => {
      const response = await fetch(
        "config/countries.json",
        {cache: "no-store"}
      );

      if (!response.ok) {
        throw new Error(`countries.json ${response.status}`);
      }

      const registry = await response.json();

      const released = (registry.countries || []).filter(
        c => c && c.released === true
      );

      if (!released.length) {
        throw new Error("No released countries in countries.json");
      }

      const requested = requestedCode();

      let current = released.find(
        c => String(c.code).toLowerCase() === requested
      );

      if (!current) {
        current = released.find(
          c => c.code === registry.default_country
        ) || released[0];
      }

      localStorage.setItem("rail_country", current.code);

      // Root index.html is the shared-schema application.
      // Standalone country applications have their own entry point.
      if ((current.app_path || "index.html") !== "index.html") {
        const target = rootTargetURL(current);

        if (target.href !== window.location.href) {
          window.location.replace(target.toString());

          // Keep the awaiting Japan load() suspended until navigation occurs.
          return await new Promise(() => {});
        }
      }

      window.RAIL_COUNTRY = current.code;
      window.RAIL_DATA_BASE =
        current.data_path || `data/${current.code}`;
      window.RAIL_COUNTRY_INFO = current;
      window.RAIL_COUNTRIES = released;
      window.RAIL_DATA_VERSION =
        current.data_version || current.asset_version || "1";

      window.RAIL_dataURL = function(name) {
        const base = String(window.RAIL_DATA_BASE || "")
          .replace(/\/$/, "");
        const version = encodeURIComponent(
          window.RAIL_DATA_VERSION
        );
        return `${base}/${name}?v=${version}`;
      };

      buildSelector(released, current);

      return current;
    })();

    return bootstrapPromise;
  }

  window.RAIL_bootstrapCountry = bootstrapCountry;
})();
