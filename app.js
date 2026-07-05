// Moteur VertiBalance
document.addEventListener("DOMContentLoaded", () => {
    const binId = localStorage.getItem("VERTIBALANCE_BIN_ID");
    if (!binId) {
        console.log("Configuration nécessaire via generation.html");
    } else {
        console.log("Profil chargé:", binId);
    }
});