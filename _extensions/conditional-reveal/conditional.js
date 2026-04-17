window.ConditionalReveal = function () {
  const PLUGIN_ID = "ConditionalReveal";
  const STORAGE_KEY = "conditional-reveal-admin";
  const DEFAULT_PASSWORD = "admin123";

  function getConfig(deck) {
    const config = deck.getConfig();
    return config.conditional || {};
  }

  function getPassword(deck) {
    const cfg = getConfig(deck);
    return cfg.adminPassword || cfg["admin-password"] || DEFAULT_PASSWORD;
  }

  function isAdminLoggedIn() {
    return localStorage.getItem(STORAGE_KEY) === "true";
  }

  function setAdminLoggedIn(value) {
    localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  }

  function storeSlidePosition(el) {
    return {
      parent: el.parentNode,
      nextSibling: el.nextSibling
    };
  }

  function hideSlide(el) {
    if (typeof Reveal !== 'undefined' && Reveal.sync) {
      // Use DOM removal + Reveal.sync
      el._storedPosition = storeSlidePosition(el);
      el.remove();
      Reveal.sync();
    } else {
      // Fallback to CSS
      el.classList.add("conditional-slide-hidden");
    }
  }

  function showSlide(el) {
    if (typeof Reveal !== 'undefined' && Reveal.sync && el._storedPosition) {
      // Use DOM restore + Reveal.sync
      const pos = el._storedPosition;
      if (pos.nextSibling) {
        pos.parent.insertBefore(el, pos.nextSibling);
      } else {
        pos.parent.appendChild(el);
      }
      delete el._storedPosition;
      Reveal.sync();
    } else {
      // Fallback to CSS
      el.classList.remove("conditional-slide-hidden");
    }
  }

  function checkConditions(el) {
    const dateAttr = el.getAttribute("data-date");
    const adminRequired = el.getAttribute("data-admin") === "true";

    // If no date attribute, use admin-only logic
    if (!dateAttr) {
      return !adminRequired || isAdminLoggedIn();
    }

    const targetDate = new Date(dateAttr);
    const datePassed = new Date() >= targetDate;

    if (datePassed) {
      // Date has passed - show to everyone
      return true;
    } else {
      // Date not passed - only show if admin required AND logged in
      return adminRequired && isAdminLoggedIn();
    }
  }

  function checkConditionalContent() {
    document.querySelectorAll(".conditional").forEach(function (el) {
      const showContent = checkConditions(el);
      const isSection = el.tagName === "SECTION";

      if (showContent) {
        if (isSection) {
          showSlide(el);
        } else {
          el.classList.remove("conditional-block-hidden");
        }
      } else {
        if (isSection) {
          hideSlide(el);
        } else {
          el.classList.add("conditional-block-hidden");
        }
      }
    });
  }

  function updateAdminButton() {
    const btn = document.getElementById("conditional-admin-button");
    if (!btn) return;

    const isLoggedIn = isAdminLoggedIn();
    btn.classList.toggle("logged-in", isLoggedIn);
    btn.title = isLoggedIn ? "Click to logout" : "Click to login";
  }

  function handleButtonClick(e) {
    const isLoggedIn = isAdminLoggedIn();

    if (isLoggedIn) {
      setAdminLoggedIn(false);
      updateAdminButton();
      checkConditionalContent();
    } else {
      const password = prompt("Enter admin password:");
      if (password === getPassword(Reveal)) {
        setAdminLoggedIn(true);
        updateAdminButton();
        checkConditionalContent();
      } else if (password !== null) {
        alert("Incorrect password");
      }
    }
  }

  function createAdminButton() {
    const btn = document.createElement("button");
    btn.id = "conditional-admin-button";
    btn.className = "conditional-admin-button";
    btn.innerHTML = '<i class="fas fa-lock"></i>';
    btn.title = "Click to login";
    btn.addEventListener("click", handleButtonClick);
    document.body.appendChild(btn);
  }

  return {
    id: PLUGIN_ID,
    init: function (deck) {
      createAdminButton();

      deck.on("ready", function() {
        updateAdminButton();
        checkConditionalContent();
      });

      deck.on("slidechanged", function() {
        checkConditionalContent();
      });
    }
  };
};