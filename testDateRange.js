// Test script to check date ranges
const now = new Date();
console.log('Current date:', now.toISOString());

// Create date range for today (local timezone)
const inputDate = new Date(now.toISOString());
const todayStart = new Date(inputDate.getFullYear(), inputDate.getMonth(), inputDate.getDate(), 0, 0, 0, 0);
const todayEnd = new Date(inputDate.getFullYear(), inputDate.getMonth(), inputDate.getDate(), 23, 59, 59, 999);

console.log('Today start (local):', todayStart.toISOString());
console.log('Today end (local):', todayEnd.toISOString());

// Your task's scheduled date
const taskScheduledDate = "2025-08-05T16:00:00.000Z";
console.log('Task scheduled date:', taskScheduledDate);

// Check if task is within today's range
const taskDate = new Date(taskScheduledDate);
const isInTodayRange = taskDate >= todayStart && taskDate <= todayEnd;
console.log('Is task in today\'s range?', isInTodayRange);

// Check if task is within this week's range
const weekStart = new Date(inputDate.getFullYear(), inputDate.getMonth(), inputDate.getDate() - inputDate.getDay(), 0, 0, 0, 0);
const weekEnd = new Date(weekStart);
weekEnd.setDate(weekEnd.getDate() + 6);
weekEnd.setHours(23, 59, 59, 999);

console.log('Week start (local):', weekStart.toISOString());
console.log('Week end (local):', weekEnd.toISOString());

const isInWeekRange = taskDate >= weekStart && taskDate <= weekEnd;
console.log('Is task in this week\'s range?', isInWeekRange); 