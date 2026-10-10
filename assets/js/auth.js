/* ============================================================
   Authentification — page de connexion
   ============================================================ */
(function () {
  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const errorBox = document.getElementById("loginError");
  const submitBtn = form.querySelector('button[type="submit"]');

  if (window.PL && PL.session) {
    window.location.href = "index.html";
    return;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.classList.add("hidden");

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      showError("Veuillez renseigner votre email et votre mot de passe.");
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
        showError(data.message || "Erreur de connexion.");
        return;
      }
      window.location.href = data.redirect || "index.html";
    } catch (err) {
      showError("Erreur réseau. Vérifiez votre connexion puis réessayez.");
    } finally {
      submitBtn.disabled = false;
    }
  });
})();