// ==========================================
// MOTEUR D'INTERFACE PATIENT (app.js)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    const BIN_ID = localStorage.getItem("VERTIBALANCE_BIN_ID");
    const app = document.getElementById("app");
    
    // 1. Vérification de la configuration
    if (!BIN_ID) {
        app.innerHTML = "<h1>Bienvenue</h1><p>Aucun profil patient détecté.</p>" +
                        "<a href='generation.html' class='btn-gen'>Initialiser le Bin Patient</a>";
        return;
    }

    // 2. Si configuré, charger l'interface et les exercices
    afficherInterfacePatient(app);
});

function afficherInterfacePatient(container) {
    container.innerHTML = `
        <h1>Interface Patient</h1>
        <p style='font-size: 0.9em; opacity: 0.7;'>Profil : #\${localStorage.getItem("VERTIBALANCE_BIN_ID").substring(0,8)}...</p>
        <button class="exo-btn" onclick="lancerExercice('Équilibre Statique')">Équilibre Statique</button>
        <button class="exo-btn" onclick="lancerExercice('Transfert de Poids')">Transfert de Poids</button>
        <button class="exo-btn" onclick="lancerExercice('Rotation Cervicale')">Rotation Cervicale</button>
    `;
}

function lancerExercice(nom) {
    alert("Lancement de l'exercice : " + nom);
    // Ajoutez ici votre logique de lancement VR
}
