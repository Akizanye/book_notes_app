// Core deps and auth utilities
import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import session from "express-session";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const saltRounds = 10;

// Single Postgres client for the whole app (credentials come from environment variables)
const db = new pg.Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT,
});
db.connect(); 

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({extended: true}));
app.use(express.static("public"));
// Session + Passport middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: true,
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Open Library cover lookup settings and a tiny inline placeholder
const OPEN_LIBRARY_API = "https://openlibrary.org/api/books";
const PLACEHOLDER_COVER =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='480' viewBox='0 0 320 480'><rect width='320' height='480' fill='%23111827'/><text x='50%' y='50%' fill='%2394a3b8' font-size='20' text-anchor='middle' font-family='Arial'>No cover</text></svg>";

// Helper: given an ISBN, try to fetch a medium/large cover URL from Open Library
async function fetchCoverUrl(isbn) {
  if (!isbn) return null;
  try {
    const { data } = await axios.get(OPEN_LIBRARY_API, {
      params: {
        bibkeys: `ISBN:${isbn}`,
        format: "json",
        jscmd: "data",
      },
      timeout: 5000,
    });
    const entry = data[`ISBN:${isbn}`];
    return entry?.cover?.medium || entry?.cover?.large || null;
  } catch (err) {
    console.log("Cover lookup failed:", err.message);
    return null;
  }
}

// Passport local strategy (email/password)
passport.use(
  new LocalStrategy(
    { usernameField: "email", passwordField: "password" },
    async (email, password, cb) => {
      try {
        const { rows } = await db.query("SELECT * FROM users WHERE email = $1", [email]);
        if (!rows.length) return cb(null, false, { message: "Invalid email or password" });
        const user = rows[0];
        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return cb(null, false, { message: "Invalid email or password" });
        return cb(null, { id: user.id, email: user.email });
      } catch (err) {
        return cb(err);
      }
    }
  )
);

passport.serializeUser((user, cb) => cb(null, user.id));
passport.deserializeUser(async (id, cb) => {
  try {
    const { rows } = await db.query("SELECT id, email FROM users WHERE id = $1", [id]);
    if (!rows.length) return cb(null, false);
    cb(null, rows[0]);
  } catch (err) {
    cb(err);
  }
});

// Expose the logged-in user's email (if any) to views for header/nav
app.use((req, res, next) => {
  res.locals.currentUser = req.user?.email || null;
  next();
});

// Simple auth gate for routes that require a logged-in user
function requireAuth(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect("/login");
  }
  next();
}

// Home page: list books with optional sort query (?sort=rating|title|recent)
app.get("/", requireAuth, async (req, res) =>{
  try {
    const sort = req.query.sort || "recent";
    const orderBy =
      sort === "rating"
        ? "ORDER BY rating DESC NULLS LAST, finished_on DESC NULLS LAST"
        : sort === "title"
        ? "ORDER BY LOWER(title) ASC"
        : "ORDER BY finished_on DESC NULLS LAST, id DESC";

    const {rows: books} = await db.query(
      `SELECT * FROM books WHERE user_id = $1 ${orderBy}`,
      [req.user.id]
    );
    res.render("index.ejs", {books: books, sort});
  } catch (error) {
    console.log(error);
    res.status(500).send("Error loading books");
  }
});

// API proxy: fetch cover URL for a given ISBN using Open Library (via axios)
app.get("/api/cover/:isbn", async (req, res) => {
  const { isbn } = req.params;
  try {
    const url = await fetchCoverUrl(isbn);
    res.json({ isbn, cover_url: url || PLACEHOLDER_COVER });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to fetch cover" });
  }
});

// Render blank form to add a book
app.get("/books/new", requireAuth, (req, res) => {
  res.render("book-form.ejs", {
    book: {},
    action: "/books",
    method: "POST",
    title: "Add a book",
  });
});

// Render form prefilled for editing a book
app.get("/books/:id/edit", requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM books WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).send("Book not found");
    res.render("book-form.ejs", {
      book: rows[0],
      action: `/books/${req.params.id}/edit`,
      method: "POST",
      title: "Edit book",
    });
  } catch (err) {
    console.log(err);
    res.status(500).send("Error loading book");
  }
});

// Create a new book from form submission
app.post("/books", requireAuth, async (req, res) => {
  const { title, author, isbn, rating, notes, finished_on } = req.body;
  try {
    await db.query(
      "INSERT INTO books (title, author, isbn, rating, notes, finished_on, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [title, author || null, isbn || null, rating || null, notes || null, finished_on || null, req.user.id]
    );
    res.redirect("/");
  } catch (err) {
    console.log(err);
    res.status(500).send("Error creating book");
  }
});

// Update an existing book from form submission
app.post("/books/:id/edit", requireAuth, async (req, res) => {
  const { title, author, isbn, rating, notes, finished_on } = req.body;
  try {
    await db.query(
      "UPDATE books SET title = $1, author = $2, isbn = $3, rating = $4, notes = $5, finished_on = $6 WHERE id = $7 AND user_id = $8",
      [title, author || null, isbn || null, rating || null, notes || null, finished_on || null, req.params.id, req.user.id]
    );
    res.redirect("/");
  } catch (err) {
    console.log(err);
    res.status(500).send("Error updating book");
  }
});

// Delete a book and redirect home
app.post("/books/:id/delete", requireAuth, async (req, res) => {
  try {
    await db.query("DELETE FROM books WHERE id = $1 AND user_id = $2", [
      req.params.id,
      req.user.id,
    ]);
    res.redirect("/");
  } catch (err) {
    console.log(err);
    res.status(500).send("Error deleting book");
  }
});

// Auth pages
app.get("/login", (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect("/");
  const error = req.query.error ? "Invalid email or password" : null;
  res.render("login.ejs", { error });
});

app.get("/register", (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect("/");
  res.render("register.ejs", { error: null });
});

app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  try {
    const existing = await db.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length) {
      return res.render("register.ejs", { error: "Email already registered" });
    }
    const hash = await bcrypt.hash(password, saltRounds);
    const { rows } = await db.query(
      "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email",
      [email, hash]
    );
    req.login({ id: rows[0].id, email: rows[0].email }, (err) => {
      if (err) {
        console.log(err);
        return res.status(500).send("Error logging in after registration");
      }
      res.redirect("/");
    });
  } catch (err) {
    console.log(err);
    res.status(500).send("Error registering user");
  }
});

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login?error=1",
  })
);

app.post("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.log(err);
      return res.status(500).send("Error logging out");
    }
    res.redirect("/login");
  });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});   
   
