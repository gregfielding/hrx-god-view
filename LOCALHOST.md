# Running localhost with the latest Placements UI

The **Preview Email** button and updated Assignments buttons (Assign All, Export, Preview Email grouped on the right) live on branch **`recovery/last-night`** only.

## One-time: use the right folder and branch

1. **Open Terminal and go to this repo:**
   ```bash
   cd /Users/gregfielding/hrx-god-view
   ```

2. **Switch to the branch that has the Placements changes:**
   ```bash
   git checkout recovery/last-night
   ```

3. **Start the app using the script (checks branch for you):**
   ```bash
   npm run start:placements
   ```
   If you're on the wrong branch, the script will refuse to start and tell you to run `git checkout recovery/last-night`.

   Or start normally (you must already be on `recovery/last-night`):
   ```bash
   npm start
   ```

4. **Open in the browser:** http://localhost:3000

5. **Check you're on the right build:**  
   Go to a Job Order → **Placements** tab. You should see:
   - **Assignments (4) (updated)** — the "(updated)" confirms the new code.
   - Three buttons on the right: **Assign All**, **Export**, **Preview Email**.  
   In the console you should see: `[PlacementsTab] Loaded WITH Preview Email button (run from /Users/gregfielding/hrx-god-view)`.

## If you still see only two buttons

- You're likely running from a **different clone** or a **different branch** (e.g. `main`).  
- Close all other terminals that might be running `npm start` from another folder.  
- In **this** repo run: `git branch --show-current` → must be `recovery/last-night`.  
- Then run `npm run start:placements` from `/Users/gregfielding/hrx-god-view`.
