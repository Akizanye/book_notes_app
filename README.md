# Book Notes

Track books you’ve read and store notes/ratings.

## Tech Stack
- Node.js, Express
- EJS templating
- axios (cover lookups/fetches)
- body-parser (request parsing)
- PostgreSQL (or your DB)
- CSS (vanilla)

## Features
- Add/edit/delete books with title, author, ISBN, rating, finished date, notes
- Sort list (recent, rating, title)
- Cover fetch via provided cover URL or ISBN fallback

## Setup
1) `npm install`
2) Copy `.env.example` to `.env` and set `DATABASE_URL`, `PORT` (etc.)
3) `npm run dev` (or `node index.js`)

## Database
```sql
CREATE TABLE books (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  isbn TEXT,
  cover_url TEXT,
  rating INT,
  finished_on DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Routes
- `GET /` list books (with sorting)
- `GET /books/new` new form
- `POST /books` create
- `GET /books/:id/edit` edit form
- `POST /books/:id` update
- `POST /books/:id/delete` delete

## Scripts
- `npm run dev` – start with nodemon (if configured)
- `npm start` – start server

## License
MIT
