# Cheka Backend

Express + MongoDB API server for the Cheka social platform.

## Live API

`https://cheka-backend.onrender.com`

---

## Deploy to Render (free tier)

1. Go to [render.com](https://render.com) and create a **New Web Service**
2. Connect your GitHub account and select this repo (`Cheka-backend`)
3. Set the following:
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Environment**: Node
4. Add these environment variables under **Environment**:

| Variable      | Description                                      |
|---------------|--------------------------------------------------|
| `MONGO_URI`   | Your MongoDB Atlas connection string             |
| `JWT_SECRET`  | Any long random string (e.g. 64 random chars)    |
| `CLOUDINARY_CLOUD_NAME` | From your Cloudinary dashboard       |
| `CLOUDINARY_API_KEY`    | From your Cloudinary dashboard       |
| `CLOUDINARY_API_SECRET` | From your Cloudinary dashboard       |
| `VAPID_PUBLIC_KEY`  | Generate with `web-push generate-vapid-keys`|
| `VAPID_PRIVATE_KEY` | Generate with `web-push generate-vapid-keys`|

5. Click **Deploy** — Render will auto-redeploy on every push to `main`

---

## API routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/signup` | Register |
| POST | `/api/auth/login` | Login |
| GET | `/api/videos` | List videos |
| POST | `/api/videos` | Upload video |
| GET | `/api/comments/:videoId` | Get comments |
| POST | `/api/comments/:videoId` | Post a comment |
| POST | `/api/comments/:id/like` | Like/unlike a comment |
| GET | `/api/notifications` | Get notifications |
| GET | `/api/follows/:userId` | Get followers/following |
| POST | `/api/follows/:userId` | Follow/unfollow |
| GET | `/api/users/:username` | Get user profile |
| GET | `/api/verifications/status` | Get verification status |
| POST | `/api/verifications/request` | Request verification badge |
| GET | `/api/referrals/me` | Get referral code & count |
| POST | `/api/referrals/apply` | Apply a referral code |

## Local development

```bash
cp .env.example .env   # fill in your values
npm install
npm start
```

Requires Node.js 18+ and a MongoDB connection.
