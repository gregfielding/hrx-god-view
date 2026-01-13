# How to Fix Vanessa Reinhard's Contact in Firestore

## Option 1: Manual Fix in Firestore Console (Easiest)

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Navigate to: **Firestore Database**
3. Find the contact:
   - Path: `tenants/{your-tenant-id}/crm_contacts/{vanessa-contact-id}`
   - Search for "Vanessa Reinhard" or find by email "vreinhart@drvita.com"
4. Check the document:
   - Look for `associations.companies` - it should be an array like `["dCTqhhcu..."]` (the company ID)
   - Check if `companyId` field exists (it probably doesn't)
5. Add the missing fields:
   - Click "Add field"
   - Field name: `companyId`
   - Type: `string`
   - Value: Copy the value from `associations.companies[0]` (the company ID)
   - Click "Add field" again
   - Field name: `companyName`
   - Type: `string`
   - Value: `Nature's Lab` (or whatever the company name is)
6. Click "Update"

## Option 2: Browser Console Script (Quick Fix)

Open your browser console on any page of the app and paste this:

```javascript
(async function fixVanessaContact() {
  const { db } = await import('./src/firebase');
  const { collection, query, where, getDocs, updateDoc, doc, getDoc } = await import('firebase/firestore');
  
  // Replace with your tenant ID (you can find it in the URL or from useAuth)
  const tenantId = 'YOUR_TENANT_ID'; // e.g., 'BCiP2bQ9CgVOCTfV6MhD'
  
  try {
    // Find Vanessa's contact by email
    const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
    const q = query(contactsRef, where('email', '==', 'vreinhart@drvita.com'));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      console.log('❌ Contact not found. Try searching by name instead.');
      return;
    }
    
    const contactDoc = snapshot.docs[0];
    const contactData = contactDoc.data();
    const contactId = contactDoc.id;
    
    console.log('📋 Found contact:', contactData.fullName || `${contactData.firstName} ${contactData.lastName}`);
    
    // Check if already fixed
    if (contactData.companyId) {
      console.log('✅ Contact already has companyId:', contactData.companyId);
      return;
    }
    
    // Get companyId from associations
    const companyId = contactData.associations?.companies?.[0];
    
    if (!companyId) {
      console.log('❌ No company found in associations.companies');
      return;
    }
    
    console.log('🏢 Found company ID:', companyId);
    
    // Get company name
    const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
    const companyDoc = await getDoc(companyRef);
    
    if (!companyDoc.exists()) {
      console.log('❌ Company not found');
      return;
    }
    
    const companyData = companyDoc.data();
    const companyName = companyData.companyName || companyData.name || 'Unknown';
    
    console.log('🏢 Company name:', companyName);
    
    // Update the contact
    const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
    await updateDoc(contactRef, {
      companyId: companyId,
      companyName: companyName,
      updatedAt: new Date()
    });
    
    console.log('✅ Successfully updated contact!');
    console.log(`   - Added companyId: ${companyId}`);
    console.log(`   - Added companyName: ${companyName}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
})();
```

**To use this:**
1. Open browser console (F12 or Cmd+Option+I)
2. Replace `YOUR_TENANT_ID` with your actual tenant ID
3. Paste and run the script

## Option 3: Fix ALL Contacts Missing companyId

If you want to fix ALL contacts that have this issue:

```javascript
(async function fixAllContacts() {
  const { db } = await import('./src/firebase');
  const { collection, getDocs, updateDoc, doc, getDoc } = await import('firebase/firestore');
  
  const tenantId = 'YOUR_TENANT_ID'; // Replace with your tenant ID
  
  try {
    console.log('🔍 Finding all contacts...');
    const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
    const snapshot = await getDocs(contactsRef);
    
    let fixed = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const contactDoc of snapshot.docs) {
      const contactData = contactDoc.data();
      
      // Skip if already has companyId
      if (contactData.companyId) {
        skipped++;
        continue;
      }
      
      // Get companyId from associations
      const companyId = contactData.associations?.companies?.[0];
      
      if (!companyId) {
        skipped++;
        continue;
      }
      
      try {
        // Get company name
        const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
        const companyDoc = await getDoc(companyRef);
        const companyName = companyDoc.exists 
          ? (companyDoc.data().companyName || companyDoc.data().name || '')
          : '';
        
        // Update contact
        const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactDoc.id);
        await updateDoc(contactRef, {
          companyId: companyId,
          companyName: companyName,
          updatedAt: new Date()
        });
        
        const name = contactData.fullName || `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim();
        console.log(`✅ Fixed: ${name} → ${companyName}`);
        fixed++;
      } catch (error) {
        console.error(`❌ Error fixing ${contactData.fullName}:`, error);
        errors++;
      }
    }
    
    console.log('\n📊 Summary:');
    console.log(`   ✅ Fixed: ${fixed}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);
    
  } catch (error) {
    console.error('Error:', error);
  }
})();
```

## Finding Your Tenant ID

You can find your tenant ID by:
1. Looking at the URL when on a tenant-specific page
2. Opening browser console and running: `window.location.pathname` (look for tenant ID in the path)
3. Or check the `useAuth()` hook in React DevTools
