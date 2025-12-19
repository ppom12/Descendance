// ======================
// DOM
// ======================
const loadBtn = document.getElementById('loadGedcom');
const fileInput = document.getElementById('gedcomInput');
const fileStatus = document.getElementById('fileStatus');

const sosaToggle = document.getElementById('sosaToggle'); // Descendants uniquement
const rootPersonSelect = document.getElementById('rootPerson');
const toggleMapColorBtn = document.getElementById('toggleMapColor');

const tables = {
    BIRT: document.getElementById('birthTable'),
    CHR: document.getElementById('baptismTable'),
    MARR: document.getElementById('marriageTable'),
    DEAT: document.getElementById('deathTable'),
    BURI: document.getElementById('burialTable'),
    RESI: document.getElementById('residenceTable')
};

function normalize(str) {
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .trim();
}

// ======================
// DONNÉES
// ======================
let individuals = {};
let families = {};
let events = {};
let mapColorMode = false;
let loadedSVGs = [];
let activeMapEvents = {
    BIRT: true,
    CHR: true,
    MARR: true,
    DEAT: true,
    BURI: true,
    RESI: true
};
let childrenMap = {};

// ======================
// CORRESPONDANCE COMMUNES
// ======================
let communeIndex = {};
let inseeToInfo = {};

Promise.all([
    fetch('data/correspondance1.json').then(r => r.json()),
    fetch('data/correspondance2.json').then(r => r.json())
])
.then(([data1, data2]) => {
    const combinedData = [...data1, ...data2]; // concaténation des deux tableaux

    combinedData.forEach(row => {
        const postalCodes = row.postal_code.split('/').map(p => p.trim());
        postalCodes.forEach(pc => {
            const key = `${pc}|${normalize(row.nom_comm)}`;
            communeIndex[key] = row.insee_com;
        });
        inseeToInfo[row.insee_com] = {
            nom_comm: row.nom_comm,
            postal_code: row.postal_code
        };
    });
})
.catch(err => console.error("Erreur chargement JSON :", err));

// ======================
// LOAD SVG INLINE
// ======================
async function loadSVG(url, containerId) {
    const res = await fetch(url);
    const text = await res.text();
    document.getElementById(containerId).innerHTML = text;
    const svg = document.getElementById(containerId).querySelector('svg');
    if (svg) loadedSVGs.push(svg);
}

loadSVG('Cartes/France.svg', 'franceMap');
loadSVG('Cartes/Guadeloupe.svg', 'map-971');
loadSVG('Cartes/Martinique.svg', 'map-972');
loadSVG('Cartes/Guyane.svg', 'map-973');
loadSVG('Cartes/Reunion.svg', 'map-974');
loadSVG('Cartes/Mayotte.svg', 'map-976');

// ======================
// LOAD GEDCOM
// ======================
loadBtn.onclick = () => fileInput.click();

fileInput.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    fileStatus.textContent = "Fichier chargé : " + file.name;
    const reader = new FileReader();
    reader.onload = ev => parseGedcom(ev.target.result);
    reader.readAsText(file);
};

// ======================
// PARSE GEDCOM
// ======================
function parseGedcom(text) {
    individuals = {};
    families = {};
    events = { BIRT:{}, CHR:{}, MARR:{}, DEAT:{}, BURI:{}, RESI:{} };

    let currentInd = null;
    let currentFam = null;
    let currentEvent = null;
    let currentEvenType = null;

    text.split(/\r?\n/).forEach(line => {
        if (line.startsWith('0 ')) {
            currentInd = null;
            currentFam = null;
            currentEvent = null;
            currentEvenType = null;
        }

        let m = line.match(/^0 @(.+?)@ INDI/);
        if (m) {
            currentInd = individuals[m[1]] = {
                id: m[1],
                name: '',
                birth: null,
                death: null,
                famc: null
            };
            return;
        }

        m = line.match(/^0 @(.+?)@ FAM/);
        if (m) {
            currentFam = families[m[1]] = {
                id: m[1],
                husb: null,
                wife: null
            };
            return;
        }

        if (currentInd) {
            m = line.match(/^1 NAME (.+)/);
            if (m) {
                const p = m[1].match(/^(.*?)\/(.*?)\//);
                currentInd.name = p ? `${p[2]} ${p[1]}`.trim() : m[1];
                return;
            }

            m = line.match(/^1 FAMC @(.+?)@/);
            if (m) { currentInd.famc = m[1]; return; }

            m = line.match(/^1 (\w+)/);
            if (m) { currentEvent = m[1]; currentEvenType = null; return; }

            m = line.match(/^2 TYPE (.+)/);
            if (m && currentEvent === 'EVEN') {
                currentEvenType = m[1].toLowerCase();
                return;
            }

            m = line.match(/^2 DATE (.+)/);
            if (m && currentEvent) {
                const y = m[1].match(/(\d{4})/);
                if (y) {
                    if (currentEvent === 'BIRT') currentInd.birth = y[1];
                    if (currentEvent === 'DEAT') currentInd.death = y[1];
                }
                return;
            }

            m = line.match(/^2 PLAC (.+)/);
            if (m && currentEvent) {
                const parts = m[1].split(',').map(p => p.trim());
                let cityRaw = null;
                let postal = null;

                if (parts.length >= 2) {
                    if (/^\d{5}$/.test(parts[0])) {
                        postal = parts[0];
                        cityRaw = parts[1];
                    } else if (/^\d{5}$/.test(parts[1])) {
                        cityRaw = parts[0];
                        postal = parts[1];
                    } else {
                        cityRaw = parts[0];
                    }
                } else {
                    cityRaw = parts[0];
                }

                let insee = null;
                if (postal && cityRaw) {
                    const keyLookup = `${postal}|${normalize(cityRaw)}`;
                    if (communeIndex[keyLookup]) insee = communeIndex[keyLookup];
                }

                const key = (currentEvent === 'EVEN' && currentEvenType === 'residence')
                    ? 'RESI'
                    : currentEvent;

                if (!events[key]) return;
                if (!events[key][currentInd.id]) events[key][currentInd.id] = [];

                events[key][currentInd.id].push({ cityRaw, postal, insee });
            }
        }

        if (currentFam) {
            m = line.match(/^1 HUSB @(.+?)@/);
            if (m) { currentFam.husb = m[1]; return; }

            m = line.match(/^1 WIFE @(.+?)@/);
            if (m) { currentFam.wife = m[1]; return; }

            if (line.match(/^1 MARR/)) { currentEvent = 'MARR'; return; }

            m = line.match(/^2 PLAC (.+)/);
            if (m && currentEvent === 'MARR') {
                const parts = m[1].split(',').map(p => p.trim());
                let cityRaw = null;
                let postal = null;

                if (parts.length >= 2) {
                    if (/^\d{5}$/.test(parts[0])) {
                        postal = parts[0];
                        cityRaw = parts[1];
                    } else if (/^\d{5}$/.test(parts[1])) {
                        cityRaw = parts[0];
                        postal = parts[1];
                    } else {
                        cityRaw = parts[0];
                    }
                } else {
                    cityRaw = parts[0];
                }

                let insee = null;
                if (postal && cityRaw) {
                    const keyLookup = `${postal}|${normalize(cityRaw)}`;
                    if (communeIndex[keyLookup]) insee = communeIndex[keyLookup];
                }

                [currentFam.husb, currentFam.wife].forEach(id => {
                    if (!id) return;
                    if (!events.MARR[id]) events.MARR[id] = [];
                    events.MARR[id].push({ cityRaw, postal, insee });
                });
            }
        }
    });

    function buildChildrenMap() {
        childrenMap = {};

        Object.values(individuals).forEach(ind => {
            if (!ind.famc) return;

            if (!childrenMap[ind.famc]) {
                childrenMap[ind.famc] = [];
            }
            childrenMap[ind.famc].push(ind.id);
        });
    }

    buildChildrenMap();
    populateRootSelect();
    renderTables();
}

// ======================
// TOUS LES DESCENDANTS
// ======================
function getDescendants(rootId) {
    const result = new Set();
    const stack = [rootId];

    while (stack.length) {
        const currentId = stack.pop();
        if (result.has(currentId)) continue;

        result.add(currentId);

        const fams = Object.values(families).filter(
            f => f.husb === currentId || f.wife === currentId
        );

        fams.forEach(fam => {
            const children = childrenMap[fam.id] || [];
            children.forEach(childId => stack.push(childId));
        });
    }

    return [...result];
}

// ======================
// LISTE DÉROULANTE
// ======================
function populateRootSelect() {
    rootPersonSelect.innerHTML = '';

    Object.values(individuals)
        .filter(i => i.name)
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        .forEach(i => {
            const o = document.createElement('option');
            const birth = i.birth || 'X';
            const death = i.death || 'X';
            o.value = i.id;
            o.textContent = `${i.name} (${birth} - ${death})`;
            rootPersonSelect.appendChild(o);
        });

    rootPersonSelect.disabled = false;
}

let descendantsMode = false; // OFF par défaut

sosaToggle.onclick = () => {
    descendantsMode = !descendantsMode;
    sosaToggle.textContent = `Descendants uniquement : ${descendantsMode ? 'ON' : 'OFF'}`;

    // 🔥 FORCER LA MISE À JOUR
    renderTables();
    if (mapColorMode) updateMaps();
};

// ======================
// CARTES
// ======================
toggleMapColorBtn.onclick = () => {
    mapColorMode = !mapColorMode;
    toggleMapColorBtn.textContent = `Colorier la carte : ${mapColorMode ? 'ON' : 'OFF'}`;
    mapColorMode ? updateMaps() : resetMaps();
};

function getAllCities() {
    const s = new Set();

    const enabledEvents = Object.keys(activeMapEvents)
        .filter(k => activeMapEvents[k]);

    if (enabledEvents.length === 0) return s;

    // 🔵 MODE INDIVIDU UNIQUEMENT
    if (descendantsMode) {
        const ids = getDescendants(rootPersonSelect.value);

        ids.forEach(id => {
            enabledEvents.forEach(eventType => {
                if (!events[eventType] || !events[eventType][id]) return;

                events[eventType][id].forEach(v => {
                    if (v.insee) s.add(v.insee);
                });
            });
        });

        return s;
    }

    // 🔵 MODE GLOBAL (comportement normal)
    enabledEvents.forEach(eventType => {
        if (!events[eventType]) return;

        for (const id in events[eventType]) {
            events[eventType][id].forEach(v => {
                if (v.insee) s.add(v.insee);
            });
        }
    });

    return s;
}

function updateMaps() {
    const cities = getAllCities();

    loadedSVGs.forEach(svg => {
        svg.querySelectorAll('polygon[id], path[id]').forEach(el => {
            const insee = el.id.match(/^(\d{5})/)?.[1];
            if (!insee) return;
            el.style.fill = cities.has(insee) ? '#2c7be5' : '#f2f2f2';
        });
    });
}

function resetMaps() {
    loadedSVGs.forEach(svg => {
        svg.querySelectorAll('polygon[id], path[id]').forEach(el => {
            el.style.fill = '#f2f2f2';
        });
    });
}

// ======================
// TABLES
// ======================
function renderTables() {
    for (const key in tables) {
        const c = {};

        const idsToProcess = descendantsMode
            ? getDescendants(rootPersonSelect.value)
            : Object.keys(events[key]);

        idsToProcess.forEach(id => {
            if (!events[key][id]) return;

            events[key][id].forEach(v => {
                const insee = v.insee || 'x';
                const postal = v.postal || 'x';
                const name = v.cityRaw || 'X';
                const label = `${name}, ${postal || 'X'}, ${insee || 'X'}`;

                c[label] = (c[label] || 0) + 1;
            });
        });

        // Correction spécifique mariages
        if (key === 'MARR') {
            for (const label in c) {
                c[label] = Math.round(c[label] / 2);
            }
        }

        tables[key].innerHTML = `
            <thead>
                <tr><th>Ville</th><th>Occurrences</th></tr>
            </thead>
            <tbody>
                ${Object.entries(c)
                    .sort((a, b) => b[1] - a[1])
                    .map(([v, n]) => `<tr><td>${v}</td><td>${n}</td></tr>`)
                    .join('')}
            </tbody>
        `;
    }

    if (mapColorMode) updateMaps();
}

rootPersonSelect.onchange = () => {
    renderTables();
    if (mapColorMode) updateMaps();
};

// ======================
// BOUTONS FILTRE ÉVÉNEMENTS
// ======================
function updateMapFilterButtons() {
    document.querySelectorAll('.map-filters button').forEach(btn => {
        const key = btn.dataset.event;
        const active = activeMapEvents[key];
        btn.classList.toggle('active', active);
        btn.textContent = `${btn.dataset.label} : ${active ? 'ON' : 'OFF'}`;
    });
}

document.querySelectorAll('.map-filters button').forEach(btn => {
    btn.onclick = () => {
        const key = btn.dataset.event;
        activeMapEvents[key] = !activeMapEvents[key];
        updateMapFilterButtons();
        if (mapColorMode) updateMaps();
    };
});
updateMapFilterButtons();
