/* ============================================================
   Authentification — page de connexion (+ vérification 2FA)
   ============================================================ */
(function () {
  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const errorBox = document.getElementById("loginError");
  const submitBtn = form.querySelector('button[type="submit"]');

  const otpForm = document.getElementById("otpForm");
  const otpInput = document.getElementById("otpCode");
  const otpError = document.getElementById("otpError");
  const otpSubmit = otpForm.querySelector('button[type="submit"]');
  const otpBack = document.getElementById("otpBack");

  let csrfToken = "";

  if (window.PL && PL.session) {
    window.location.href = "index.html";
    return;
  }

  function showError(box, message) {
    box.textContent = message;
    box.classList.remove("hidden");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.classList.add("hidden");

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      showError(errorBox, "Veuillez renseigner votre email et votre mot de passe.");
      return;
    }

    submitBtn.disabled = true;
    try {
      const res = await fetch("api/auth/login.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password })
      });
      const data = await res.json();
      if (!res.ok) {
        showError(errorBox, data.message || "Erreur de connexion.");
        return;
      }
      if (data.two_factor) {
        csrfToken = data.csrf || "";
        form.classList.add("hidden");
        otpForm.classList.remove("hidden");
        otpInput.value = "";
        otpInput.focus();
        return;
      }
      window.location.href = data.redirect || "index.html";
    } catch (err) {
      showError(errorBox, "Erreur réseau. Vérifiez votre connexion puis réessayez.");
    } finally {
      submitBtn.disabled = false;
    }
  });

  otpForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    otpError.classList.add("hidden");

    const code = otpInput.value.replace(/\D/g, "");
    if (code.length !== 6) {
      showError(otpError, "Le code doit contenir 6 chiffres.");
      return;
    }

    otpSubmit.disabled = true;
    try {
      const res = await fetch("api/auth/verify_otp.php", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify({ code: code })
      });
      const data = await res.json();
      if (!res.ok) {
        showError(otpError, data.message || "Code invalide.");
        return;
      }
      window.location.href = data.redirect || "index.html";
    } catch (err) {
      showError(otpError, "Erreur réseau. Réessayez.");
    } finally {
      otpSubmit.disabled = false;
    }
  });

  otpBack.addEventListener("click", () => {
    otpError.classList.add("hidden");
    otpForm.classList.add("hidden");
    form.classList.remove("hidden");
    passwordInput.value = "";
    passwordInput.focus();
  });
})();
