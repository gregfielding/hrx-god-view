require('dotenv').config();
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Change this to your tenant ID (e.g. BCiP2bQ9CgVOCTfV6MhD)
const tenantId = process.env.TENANT_ID || 'REPLACE_WITH_YOUR_TENANT_ID';

const taxonomyEsSeedByCategory = {
  additionalScreenings: {
    'Influenza (Flu Shot)': 'Influenza (vacuna contra la gripe)',
    'MMR Titer (Measles, Mumps, Rubella)': 'Titulación MMR (sarampión, paperas, rubéola)',
    'TB Blood Test (Quantiferon)': 'Prueba de sangre para TB (Quantiferon)',
    'TB Skin Test (PPD)': 'Prueba cutánea de TB (PPD)',
    'Tdap (Tetanus, Diphtheria, Pertussis)': 'Tdap (tétanos, difteria, tos ferina)',
    'Varicella (Chickenpox) Titer': 'Titulación de varicela (varicela)',
  },

  backgroundCheckPackages: {
    '7-Year County Criminal Check': 'Revisión de antecedentes penales del condado (7 años)',
    'Basic National Criminal Check': 'Revisión nacional básica de antecedentes penales',
    'Federal Criminal Search': 'Búsqueda federal de antecedentes penales',
    'Sex Offender Registry': 'Registro de delincuentes sexuales',
    'Statewide Criminal Search': 'Búsqueda estatal de antecedentes penales',
  },

  drugScreeningPanels: {
    '10-Panel (No THC)': 'Panel de 10 (sin THC)',
    '10-Panel (With THC)': 'Panel de 10 (con THC)',
    '4-Panel (No THC)': 'Panel de 4 (sin THC)',
  },

  educationLevels: {
    'High School Diploma': 'Diploma de preparatoria',
    'No Education Requirement': 'Sin requisito de educación',
  },

  experienceLevels: {
    '1–2 Years': '1–2 años',
    '3–5 Years (Mid-Level)': '3–5 años (nivel intermedio)',
    'Entry-Level (0–1 year)': 'Nivel inicial (0–1 año)',
    'No Experience Required': 'No se requiere experiencia',
  },

  languages: {
    English: 'Inglés',
    Spanish: 'Español',
  },

  licensesCerts: {
    'Alcohol Server Permit (TABC/TIPS/ABC) (Certification)':
      'Permiso para servir alcohol (TABC/TIPS/ABC) (certificación)',
    'Food Handler Card (Certification)':
      'Tarjeta de manipulador de alimentos (certificación)',
    'Forklift Certification (Class I–VII) (Certification)':
      'Certificación de montacargas (Clase I–VII) (certificación)',
  },

  physicalRequirements: {
    'Carrying 25 lbs': 'Cargar 25 lb',
    'Lifting 25 lbs': 'Levantar 25 lb',
    'Lifting 50 lbs': 'Levantar 50 lb',
    Standing: 'Estar de pie',
    Walking: 'Caminar',
  },

  requiredPpe: {
    'Hard Hat': 'Casco de seguridad',
    'Safety Glasses': 'Gafas de seguridad',
  },

  shift: {
    '8 Hour': '8 horas',
    '10 Hour': '10 horas',
    '12 Hour': '12 horas',
    'Day Shift': 'Turno de día',
    'First Shift': 'Primer turno',
    'Second Shift': 'Segundo turno',
    'Night Shift': 'Turno nocturno',
    'Full Time': 'Tiempo completo',
    'Part Time': 'Medio tiempo',
    Temporary: 'Temporal',
    'Some Weekends': 'Algunos fines de semana',
  },

  skills: {
    'Cooking Level 1': 'Cocina nivel 1',
    'Cooking Level 2': 'Cocina nivel 2',
    'Food Safety': 'Seguridad alimentaria',
    'Reading Comprehension': 'Comprensión lectora',
  },

  uniformRequirements: {
    'Black Pants': 'Pantalones negros',
    'Business Casual': 'Business casual',
    'Closed-Toe Shoes': 'Zapatos cerrados',
    'Non-Slip Shoes': 'Zapatos antideslizantes',
    'Uniform Provided': 'Uniforme proporcionado',
    Warehouse: 'Almacén',
  },
};

// Flatten to a single EN -> ES map (translation code expects taxonomy.es as Record<string, string>)
const taxonomyEs = Object.assign({}, ...Object.values(taxonomyEsSeedByCategory));

async function run() {
  const ref = db.doc(`tenants/${tenantId}/translation_settings/default`);

  await ref.set(
    {
      taxonomy: {
        es: taxonomyEs,
      },
    },
    { merge: true }
  );

  console.log('✅ Taxonomy ES seeded successfully for tenant', tenantId);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
