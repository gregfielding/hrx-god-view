# HRX Companion App – Project Context & Requirements

This document provides all the context and requirements for building the **HRX Companion** Flutter app, which will serve as the primary communication tool for workers.  
**Please use this as the basis for all code, architecture, and integration decisions.**

---

## **Authentication**

- **Login with Email & Password** using Firebase Auth.
- **FaceID/TouchID** option for biometric login (after initial email/password login).
- **SSO/Enterprise Options:**  
  - If possible, support SSO (Google, Microsoft, etc.) or other enterprise login options.

---

## **Main UI Layout**

- **Chat Interface:**  
  - Should take up **90%+ of the screen**.
  - This is the primary interface for worker communication.
- **Notification Indicator:**  
  - Prominently display when there are unread messages or system notifications.
- **Hamburger/Drawer Menu:**  
  - Links to:
    - **Chat History**
    - **Profile Settings**
      - Job title, role, department, location
      - Home address
      - Phone number
    - **Qualifications**
      - Everything from the UserProfile > Qualifications Tab in the web app

---

## **Profile & Qualifications**

- **Profile Settings** should allow the user to view and edit:
  - Job title, role, department, location
  - Home address
  - Phone number
- **Qualifications** should display all data shown in the web app’s UserProfile > Qualifications Tab, including:
  - Education
  - Work experience
  - Certifications
  - Background check status
  - Vaccination status

---


## **Firestore & Logging Integration**

- **Every interaction from the worker** (e.g., sending a message, updating profile, etc.) should **trigger an AI log**.
- **Logging should be as simple and efficient as possible.**
  - If possible, trigger logs directly from the app when an action occurs.
  - Alternatively, if Firestore changes (writes/updates) can trigger logs via backend functions, use that method if it’s more efficient.
- **Ask for guidance on which approach is best based on the existing backend implementation.**

---

## **Technical Requirements**

- **Flutter** (Dart) for cross-platform mobile development.
- **Firebase Auth** for authentication.
- **Firestore** for real-time data (chat, profile, qualifications, etc.).
- **Push Notifications** (Firebase Cloud Messaging) for real-time alerts.
- **Biometric Auth** (FaceID/TouchID) for quick login after initial authentication.

---

## **Design & UX**

- **Modern, clean, and accessible UI.**
- **Chat interface** should be the focal point.
- **Easy navigation** via hamburger/drawer menu.
- **Responsive** and works well on both iOS and Android.

---

## **Reference: Web Project Structure**

- The web project uses Firestore for user data, chat, and logging.
- User profile and qualifications data are stored in Firestore under the `users` collection.
- AI logs are created for each significant user action or interaction.

---

## **Questions for the AI/Developer**

- Should AI logs be triggered directly from the app, or should Firestore triggers (Cloud Functions) handle logging on data changes?
- What is the recommended way to structure chat data in Firestore for scalability and performance?
- How should push notifications be handled for chat and system alerts?

---

**Please use this document as the authoritative source for all Companion app development decisions.** 