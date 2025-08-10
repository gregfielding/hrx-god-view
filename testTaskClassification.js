// Test script for task classification layout
const testTasks = [
  {
    id: '1',
    title: 'Research company background',
    description: 'Gather information about their industry and current staffing situation',
    type: 'research',
    classification: 'todo',
    status: 'upcoming',
    priority: 'medium',
    scheduledDate: '2025-08-10',
    estimatedDuration: 30,
    aiSuggested: true
  },
  {
    id: '2',
    title: 'Schedule initial discovery call',
    description: 'Set up a meeting to understand their staffing needs',
    type: 'scheduled_meeting_virtual',
    classification: 'appointment',
    status: 'overdue',
    priority: 'high',
    scheduledDate: '2025-08-04',
    startTime: '2025-08-04T14:00:00Z',
    duration: 30,
    associations: {
      contacts: ['contact1', 'contact2']
    }
  },
  {
    id: '3',
    title: 'Send follow-up email',
    description: 'Follow up on the discovery call with additional information',
    type: 'email',
    classification: 'todo',
    status: 'due',
    priority: 'high',
    scheduledDate: '2025-08-05',
    estimatedDuration: 15
  },
  {
    id: '4',
    title: 'Prepare proposal presentation',
    description: 'Create slides for the proposal presentation',
    type: 'presentation',
    classification: 'appointment',
    status: 'scheduled',
    priority: 'medium',
    scheduledDate: '2025-08-12',
    startTime: '2025-08-12T10:00:00Z',
    duration: 60,
    associations: {
      companies: ['company1'],
      contacts: ['contact1']
    }
  }
];

// Simulate the classification logic
const todoTasks = testTasks.filter(task => task.classification === 'todo');
const appointmentTasks = testTasks.filter(task => 
  task.classification === 'appointment' || !task.classification
);

console.log('=== Task Classification Test ===');
console.log(`Total tasks: ${testTasks.length}`);
console.log(`Todo tasks: ${todoTasks.length}`);
console.log(`Appointment tasks: ${appointmentTasks.length}`);

console.log('\n=== Todo Tasks (Left 25%) - Compact Layout ===');
todoTasks.forEach(task => {
  console.log(`- ${task.title} (${task.status}, ${task.priority})`);
  if (task.description) {
    console.log(`  Description: ${task.description.substring(0, 50)}...`);
  }
});

console.log('\n=== Appointment Tasks (Right 75%) ===');
appointmentTasks.forEach(task => {
  console.log(`- ${task.title} (${task.status}, ${task.priority})`);
  if (task.startTime) {
    console.log(`  Time: ${new Date(task.startTime).toLocaleTimeString()}`);
  }
  if (task.associations?.contacts) {
    console.log(`  Contacts: ${task.associations.contacts.length}`);
  }
});

console.log('\n✅ Task classification layout test completed!');
