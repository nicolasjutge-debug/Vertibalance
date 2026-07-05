// ==========================================
// CONFIGURATION JSONBIN & NAVIGATION MANUELLE (Plus fiable)
// ==========================================
let BIN_ID = localStorage.getItem("VERTIBALANCE_BIN_ID") || ""; 
const MASTER_KEY = "$2a$10$37WLUrV6lE8yluKasDN/nuzRMkF98j/gvrCuEj5KwNr0AuZkTPHnG"; 
const JSONBIN_URL = "https://api.jsonbin.io/v3/b";

document.addEventListener("DOMContentLoaded", () => {
    const statusDiv = document.getElementById("sync-status");
    const createBtn = document.getElementById("btn-create-bin");

    // Si le BIN existe déjà, afficher le bouton d'accès direct
    if (BIN_ID) {
        statusDiv.innerHTML = `Connecté au Bin : ${BIN_ID}<br><button onclick="window.location.replace('index.html')" style="padding:10px; margin-top:10px; cursor:pointer; background:#00C9A7; border:none; color:#0a1628; font-weight:bold; border-radius:5px;">Accéder à l'interface</button>`;
    }

    if (createBtn) {
        createBtn.addEventListener("click", () => {
            creerBinAutomatiquement();
        });
    }
});

function creerBinAutomatiquement() {
    const statusDiv = document.getElementById("sync-status");
    const createBtn = document.getElementById("btn-create-bin");
    
    statusDiv.innerText = "Création du BIN en cours...";
    createBtn.style.display = "none";

    fetch(JSONBIN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Master-Key": MASTER_KEY,
            "X-Bin-Private": "true"
        },
        body: JSON.stringify({ status: "initialisé" })
    })
    .then(r => r.json())
    .then(result => {
        BIN_ID = result.metadata.id;
        localStorage.setItem("VERTIBALANCE_BIN_ID", BIN_ID);
        
        // Affichage du bouton de navigation manuelle
        statusDiv.innerHTML = `BIN créé avec succès : ${BIN_ID}<br><button onclick="window.location.replace('index.html')" style="padding:15px; margin-top:20px; cursor:pointer; background:#00C9A7; border:none; color:#0a1628; font-weight:bold; border-radius:8px; font-size:16px;">Accéder à l'Interface Patient</button>`;
    })
    .catch(err => {
        statusDiv.innerText = "Erreur de création. Réessayez.";
        createBtn.style.display = "block";
        console.error(err);
    });
}
