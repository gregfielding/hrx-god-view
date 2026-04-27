# Cursor Deployment Configuration Guide

This guide helps you configure Cursor to deploy to Firebase and GitHub automatically.

## 🔐 Authentication Setup

### 1. Firebase CI Token (for non-interactive deployments)

Firebase CLI authentication expires, so we need a CI token for automated deployments.

**Generate a Firebase CI token:**
```bash
cd /Users/gregfielding/Projects/hrx-god-view
firebase login:ci
```

This will:
- Open a browser for authentication
- Generate a token that you can use for non-interactive deployments
- Save the token securely (you'll need to add it to environment variables)

**Add token to environment:**
```bash
# Add to your shell profile (~/.zshrc or ~/.bash_profile)
export FIREBASE_TOKEN="your-token-here"
```

**Or create a `.env.local` file in the project root:**
```bash
FIREBASE_TOKEN=your-token-here
```

### 2. GitHub Authentication

You have git credential helpers configured. For Cursor to push to GitHub, ensure:

**Option A: Use existing credentials (recommended)**
- Your macOS keychain should already have GitHub credentials
- Cursor can use these through the credential helper

**Option B: Create a GitHub Personal Access Token (for CI/CD)**
1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate a new token with `repo` scope
3. Use it when prompted, or configure in git:
   ```bash
   git config --global credential.helper store
   # Then push once with the token as password
   ```

**Option C: Use SSH keys**
```bash
# Generate SSH key if you don't have one
ssh-keygen -t ed25519 -C "your_email@example.com"

# Add to GitHub
# Copy public key: cat ~/.ssh/id_ed25519.pub
# Add to GitHub → Settings → SSH and GPG keys

# Test connection
ssh -T git@github.com
```

## 🚀 Deployment Commands

### Firebase Deployment

**Deploy all functions:**
```bash
firebase deploy --only functions
```

**Deploy specific function:**
```bash
firebase deploy --only functions:scheduledOrchestrator
```

**Deploy hosting:**
```bash
firebase deploy --only hosting
```

**Deploy everything:**
```bash
firebase deploy
```

### GitHub Deployment

**Push to main branch:**
```bash
git add .
git commit -m "Your commit message"
git push origin main
```

**Push to specific branch:**
```bash
git push origin branch-name
```

## ⚙️ Cursor Configuration

### Environment Variables for Cursor

Create a `.cursor-env` file or add to your shell profile:

```bash
# Firebase
export FIREBASE_TOKEN="your-ci-token"
export FIREBASE_PROJECT_ID="hrx1-d3beb"

# GitHub (if using token)
export GITHUB_TOKEN="your-github-token"
```

### Cursor Settings

Cursor should automatically use:
- Your system's git credentials (via credential helpers)
- Firebase CLI authentication (if logged in)
- Environment variables from your shell

## 🔧 Troubleshooting

### Firebase Authentication Issues

**Problem:** "Authentication Error: Your credentials are no longer valid"

**Solution:**
1. Re-authenticate: `firebase login --reauth`
2. Generate CI token: `firebase login:ci`
3. Use token in environment variable

### GitHub Push Issues

**Problem:** "Permission denied" or authentication required

**Solution:**
1. Check credential helper: `git config --list | grep credential`
2. Test push: `git push --dry-run`
3. If needed, use GitHub token or SSH key

### Cursor Can't Access Credentials

**Problem:** Cursor can't find Firebase/GitHub credentials

**Solution:**
1. Ensure credentials are in system keychain (macOS)
2. Add environment variables to Cursor's environment
3. Restart Cursor after adding environment variables

## 📝 Quick Setup Checklist

- [ ] Generate Firebase CI token: `firebase login:ci`
- [ ] Add `FIREBASE_TOKEN` to environment variables
- [ ] Verify GitHub credentials work: `git push --dry-run`
- [ ] Test Firebase deployment: `firebase deploy --only functions:scheduledOrchestrator`
- [ ] Test GitHub push: `git push origin main`
- [ ] Configure Cursor environment variables if needed

## 🎯 Next Steps

1. **Generate Firebase CI token** (run in terminal):
   ```bash
   firebase login:ci
   ```

2. **Add token to environment**:
   ```bash
   export FIREBASE_TOKEN="your-token-here"
   # Add to ~/.zshrc to make permanent
   ```

3. **Test deployment**:
   ```bash
   firebase deploy --only functions:scheduledOrchestrator
   ```

4. **Verify GitHub access**:
   ```bash
   git push --dry-run
   ```

Once these are set up, Cursor should be able to deploy to both Firebase and GitHub automatically!
