import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const motivations = [
  {
    text: "Success is not final, failure is not fatal: It is the courage to continue that counts.",
    quote: "Success is not final, failure is not fatal: it is the courage to continue that counts.",
    author: "Winston Churchill",
    toneTags: ["Resilient", "Confident"],
    roleTags: ["Sales", "Warehouse"]
  },
  {
    text: "Your calm mind is the ultimate weapon against your challenges. So relax.",
    quote: "Your calm mind is the ultimate weapon against your challenges.",
    author: "Robert Greene",
    toneTags: ["Calm", "Mindful"],
    roleTags: ["Customer Service", "Healthcare"]
  },
  {
    text: "Focus on being productive instead of busy.",
    quote: "Focus on being productive instead of busy.",
    author: "Tim Ferriss",
    toneTags: ["Focused", "Disciplined"],
    roleTags: ["Admin", "Remote"]
  },
  {
    text: "Kindness is free to give, but priceless to receive.",
    toneTags: ["Empathetic", "Positive"],
    roleTags: ["Customer Service", "Healthcare"]
  },
  {
    text: "Every shift is a step forward. Keep going.",
    toneTags: ["Encouraging", "Resilient"],
    roleTags: ["Warehouse", "Hospitality"]
  },
  {
    text: "Patience and perseverance have a magical effect before which difficulties disappear.",
    toneTags: ["Calm", "Focused"],
    roleTags: ["Customer Service", "Field Ops"]
  },
  {
    text: "Don't wish for it. Work for it.",
    toneTags: ["Confident", "Tactical"],
    roleTags: ["Sales", "Warehouse"]
  },
  {
    text: "Clear mind, steady hands, strong heart.",
    toneTags: ["Mindful", "Focused"],
    roleTags: ["Healthcare", "Leadership"]
  },
  {
    text: "Progress, not perfection.",
    toneTags: ["Uplifting", "Disciplined"],
    roleTags: ["Admin", "Remote"]
  },
  {
    text: "Each call is a chance to help someone feel heard.",
    toneTags: ["Empathetic", "Positive"],
    roleTags: ["Customer Service", "Healthcare"]
  },
  {
    text: "Great things never come from comfort zones.",
    toneTags: ["Energetic", "Tactical"],
    roleTags: ["Sales", "Field Ops"]
  },
  {
    text: "A strong team starts with strong individuals. You're one of them.",
    toneTags: ["Uplifting", "Encouraging"],
    roleTags: ["All"]
  },
  {
    text: "Be the reason someone smiles today.",
    toneTags: ["Empathetic", "Positive"],
    roleTags: ["Hospitality", "Customer Service"]
  },
  {
    text: "When it's hard, that's when it matters most.",
    toneTags: ["Resilient", "Focused"],
    roleTags: ["Warehouse", "Healthcare"]
  },
  {
    text: "You've overcome before. You can do it again.",
    toneTags: ["Resilient", "Uplifting"],
    roleTags: ["All"]
  },
  {
    text: "Keep your head up. Your work matters more than you know.",
    toneTags: ["Reflective", "Encouraging"],
    roleTags: ["Warehouse", "Admin"]
  },
  {
    text: "Small steps build big days.",
    toneTags: ["Disciplined", "Encouraging"],
    roleTags: ["Admin", "Remote"]
  },
  {
    text: "Sometimes showing up is the biggest win of all.",
    toneTags: ["Resilient", "Mindful"],
    roleTags: ["Field Ops", "Healthcare"]
  },
  {
    text: "Stay grounded. Stay focused. Stay kind.",
    toneTags: ["Mindful", "Calm"],
    roleTags: ["Leadership", "Healthcare"]
  },
  {
    text: "You don't have to be perfect. Just consistent.",
    toneTags: ["Disciplined", "Positive"],
    roleTags: ["Warehouse", "Sales"]
  },
  {
    text: "One kind word can change someone's entire shift.",
    toneTags: ["Empathetic", "Encouraging"],
    roleTags: ["Hospitality", "Customer Service"]
  },
  {
    text: "The way you do small things determines big outcomes.",
    toneTags: ["Tactical", "Focused"],
    roleTags: ["Warehouse", "Admin"]
  },
  {
    text: "Today is a fresh start. Make it count.",
    toneTags: ["Uplifting", "Energetic"],
    roleTags: ["All"]
  },
  {
    text: "Patience, grace, and grit. You've got this.",
    toneTags: ["Calm", "Resilient"],
    roleTags: ["Customer Service", "Healthcare"]
  },
  {
    text: "Your best is enough today.",
    toneTags: ["Encouraging", "Reflective"],
    roleTags: ["All"]
  }
];

async function seedMotivationLibrary() {
  const collectionRef = db.collection('motivationMessages');
  let count = 0;
  for (const motivation of motivations) {
    await collectionRef.add({
      ...motivation,
      quote: motivation.quote || '',
      author: motivation.author || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      approved: true,
      isActive: true,
      usageCount: 0,
      averageRating: 0,
      source: 'seed',
    });
    count++;
    console.log(`✅ Added: "${motivation.text}"${motivation.author ? ` — ${motivation.author}` : ''}`);
  }
  console.log(`\nSeeded ${count} motivation messages!`);
  process.exit(0);
}

seedMotivationLibrary().catch((err) => {
  console.error('Error seeding motivation library:', err);
  process.exit(1);
}); 