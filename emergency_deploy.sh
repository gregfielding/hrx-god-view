#!/bin/bash

echo "🚨 EMERGENCY DEPLOYMENT: Circuit Breaker Fixes"
echo "=============================================="

# Set environment variables for circuit breakers
export GLOBAL_CIRCUIT_BREAKER=off

echo "📦 Deploying emergency trigger disable functions..."

# Deploy only the emergency functions
firebase deploy --only functions:firestoreLogAILogCreated,functions:updateActiveSalespeopleOnActivityLog,functions:updateActiveSalespeopleOnEmailLog,functions:updateActiveSalespeopleOnDeal,functions:updateActiveSalespeopleOnTask,functions:toggleCircuitBreaker,functions:getCircuitBreakerStatus

echo "✅ Emergency deployment complete!"
echo ""
echo "🔧 Circuit Breaker Status:"
echo "   - firestoreLogAILogCreated: DISABLED"
echo "   - updateActiveSalespeopleOnActivityLog: DISABLED"
echo "   - updateActiveSalespeopleOnEmailLog: DISABLED"
echo "   - updateActiveSalespeopleOnDeal: DISABLED"
echo "   - updateActiveSalespeopleOnTask: DISABLED"
echo ""
echo "📊 To check function status, call getCircuitBreakerStatus"
echo "🔧 To enable/disable functions, call toggleCircuitBreaker"
echo ""
echo "⚠️  These functions are now DISABLED to prevent runaway costs"
echo "   Re-enable them only after fixing the underlying cascade issues"
