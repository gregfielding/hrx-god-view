const { initializeApp } = require('firebase/app');
const { getFirestore, doc, updateDoc } = require('firebase/firestore');

// Firebase config - you'll need to add your actual config
const firebaseConfig = {
  apiKey: "AIzaSyBxJxJxJxJxJxJxJxJxJxJxJxJxJxJxJx",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdefghijklmnop"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateTaskDate() {
  try {
    // Get current date in local timezone
    const now = new Date();
    console.log('Current date:', now.toISOString());
    
    // Set task to be scheduled for 2 PM today (local time)
    const scheduledTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0, 0); // 2 PM
    
    console.log('Scheduled time:', scheduledTime.toISOString());
    
    // You'll need to replace 'YOUR_TASK_ID' with the actual task ID
    const taskRef = doc(db, 'tenants', 'BCiP2bQ9CgVOCTfV6MhD', 'tasks', 'YOUR_TASK_ID');
    
    await updateDoc(taskRef, {
      scheduledDate: scheduledTime.toISOString(),
      updatedAt: new Date()
    });
    
    console.log('Task scheduled date updated successfully!');
  } catch (error) {
    console.error('Error updating task:', error);
  }
}

updateTaskDate(); 