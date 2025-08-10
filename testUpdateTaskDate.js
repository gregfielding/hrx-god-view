const { initializeApp } = require('firebase/app');
const { getFirestore, doc, updateDoc } = require('firebase/firestore');

// Your Firebase config
const firebaseConfig = {
  // Add your Firebase config here
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateTaskDate() {
  try {
    // Get current date in local timezone
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    
    // Set task to be scheduled for 2 PM today (local time)
    const scheduledTime = new Date(todayStart);
    scheduledTime.setHours(14, 0, 0, 0); // 2 PM
    
    console.log('Current date:', now.toISOString());
    console.log('Today start:', todayStart.toISOString());
    console.log('Scheduled time:', scheduledTime.toISOString());
    
    // Update the task
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