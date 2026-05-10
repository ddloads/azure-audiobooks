import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Generate evenly-split audio file records for a book
const makeFiles = (folderPath: string, totalSeconds: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    filename: `part${String(i + 1).padStart(2, "0")}.mp3`,
    path: `${folderPath}/part${String(i + 1).padStart(2, "0")}.mp3`,
    duration: totalSeconds / count,
    index: i,
  }));

// Slugify for folder names
const slug = (s: string) => s.replace(/[^a-z0-9]/gi, "_").toLowerCase();

async function main() {
  console.log("Clearing existing data...");
  await prisma.progress.deleteMany();
  await prisma.audioFile.deleteMany();
  await prisma.book.deleteMany();
  await prisma.librarySource.deleteMany();
  await prisma.library.deleteMany();
  await prisma.series.deleteMany();
  await prisma.author.deleteMany();
  await prisma.user.deleteMany();

  const defaultLibrary = await prisma.library.create({
    data: {
      name: "Default Library",
      description: "Primary local audiobook library",
      sources: {
        create: {
          label: "Default local storage",
          path: "data/library",
          kind: "LOCAL",
          isEnabled: true,
          isWritable: true,
        },
      },
    },
  });

  // ── Users ────────────────────────────────────────────────────────────────
  const [adminHash, demoHash] = await Promise.all([
    bcrypt.hash("admin123", 10),
    bcrypt.hash("demo123", 10),
  ]);
  await prisma.user.createMany({
    data: [
      { username: "admin", password: adminHash, role: "ADMIN" },
      { username: "demo",  password: demoHash,  role: "USER"  },
    ],
  });
  console.log("Created users: admin / demo");

  // ── Authors ───────────────────────────────────────────────────────────────
  const authorNames = [
    "J.R.R. Tolkien",
    "J.K. Rowling",
    "Frank Herbert",
    "George R.R. Martin",
    "Douglas Adams",
    "Terry Pratchett",
    "Brandon Sanderson",
    "Andrzej Sapkowski",
    "George Orwell",
    "Aldous Huxley",
    "Ray Bradbury",
    "Andy Weir",
    "Orson Scott Card",
    "William Gibson",
    "Ursula K. Le Guin",
    "Daniel Keyes",
    "Philip K. Dick",
    "H.G. Wells",
    "Kurt Vonnegut",
    "Patrick Rothfuss",
    "Terry Pratchett & Neil Gaiman",
    "Neil Gaiman",
  ];

  await prisma.author.createMany({ data: authorNames.map((name) => ({ name })) });
  const authorRows = await prisma.author.findMany();
  const A = Object.fromEntries(authorRows.map((a) => [a.name, a.id]));

  // ── Series ────────────────────────────────────────────────────────────────
  const seriesNames = [
    "The Lord of the Rings",
    "Harry Potter",
    "Dune Chronicles",
    "A Song of Ice and Fire",
    "The Hitchhiker's Guide to the Galaxy",
    "Discworld",
    "The Stormlight Archive",
    "The Witcher Saga",
  ];

  await prisma.series.createMany({ data: seriesNames.map((name) => ({ name })) });
  const seriesRows = await prisma.series.findMany();
  const S = Object.fromEntries(seriesRows.map((s) => [s.name, s.id]));

  // ── Books ─────────────────────────────────────────────────────────────────
  type BookDef = {
    title: string;
    author: string;
    series?: string;
    sequence?: number;
    description: string;
    hours: number;
    files: number;
  };

  const books: BookDef[] = [
    // ── The Lord of the Rings ─────────────────────────────────────────────
    {
      title: "The Fellowship of the Ring",
      author: "J.R.R. Tolkien",
      series: "The Lord of the Rings", sequence: 1,
      description: "The first part of Tolkien's epic quest to destroy the One Ring and save Middle-earth.",
      hours: 19, files: 4,
    },
    {
      title: "The Two Towers",
      author: "J.R.R. Tolkien",
      series: "The Lord of the Rings", sequence: 2,
      description: "The Fellowship is broken. Frodo and Sam journey toward Mordor while Aragorn leads the fight against Saruman.",
      hours: 17, files: 4,
    },
    {
      title: "The Return of the King",
      author: "J.R.R. Tolkien",
      series: "The Lord of the Rings", sequence: 3,
      description: "The final volume of The Lord of the Rings, bringing all threads to their epic conclusion.",
      hours: 20, files: 4,
    },

    // ── Harry Potter ──────────────────────────────────────────────────────
    {
      title: "Harry Potter and the Philosopher's Stone",
      author: "J.K. Rowling",
      series: "Harry Potter", sequence: 1,
      description: "A young boy discovers he is a wizard on his eleventh birthday and enters a magical world.",
      hours: 8, files: 2,
    },
    {
      title: "Harry Potter and the Chamber of Secrets",
      author: "J.K. Rowling",
      series: "Harry Potter", sequence: 2,
      description: "Harry's second year at Hogwarts is haunted by a mysterious terror that is turning students to stone.",
      hours: 9, files: 2,
    },
    {
      title: "Harry Potter and the Prisoner of Azkaban",
      author: "J.K. Rowling",
      series: "Harry Potter", sequence: 3,
      description: "A dangerous prisoner has escaped from Azkaban and everyone believes he is after Harry.",
      hours: 11, files: 3,
    },
    {
      title: "Harry Potter and the Goblet of Fire",
      author: "J.K. Rowling",
      series: "Harry Potter", sequence: 4,
      description: "Harry is unexpectedly entered in the deadly Triwizard Tournament.",
      hours: 21, files: 4,
    },
    {
      title: "Harry Potter and the Order of the Phoenix",
      author: "J.K. Rowling",
      series: "Harry Potter", sequence: 5,
      description: "Harry forms Dumbledore's Army as the Ministry of Magic refuses to acknowledge Voldemort's return.",
      hours: 27, files: 5,
    },
    {
      title: "Harry Potter and the Half-Blood Prince",
      author: "J.K. Rowling",
      series: "Harry Potter", sequence: 6,
      description: "Dumbledore prepares Harry for the final confrontation while revealing Voldemort's dark past.",
      hours: 20, files: 4,
    },
    {
      title: "Harry Potter and the Deathly Hallows",
      author: "J.K. Rowling",
      series: "Harry Potter", sequence: 7,
      description: "Harry, Ron, and Hermione set out to find and destroy Voldemort's remaining Horcruxes.",
      hours: 24, files: 5,
    },

    // ── Dune Chronicles ───────────────────────────────────────────────────
    {
      title: "Dune",
      author: "Frank Herbert",
      series: "Dune Chronicles", sequence: 1,
      description: "Set on the desert planet Arrakis, the epic story of Paul Atreides and the fate of the known universe.",
      hours: 21, files: 4,
    },
    {
      title: "Dune Messiah",
      author: "Frank Herbert",
      series: "Dune Chronicles", sequence: 2,
      description: "Twelve years into his reign, Emperor Paul Muad'Dib faces the consequences of his holy war.",
      hours: 10, files: 3,
    },
    {
      title: "Children of Dune",
      author: "Frank Herbert",
      series: "Dune Chronicles", sequence: 3,
      description: "The children of Paul Muad'Dib face threats from within the empire and must find their own destiny.",
      hours: 14, files: 3,
    },
    {
      title: "God Emperor of Dune",
      author: "Frank Herbert",
      series: "Dune Chronicles", sequence: 4,
      description: "Three thousand years after Paul Atreides, the God Emperor Leto II rules over a transformed universe.",
      hours: 15, files: 3,
    },

    // ── A Song of Ice and Fire ─────────────────────────────────────────────
    {
      title: "A Game of Thrones",
      author: "George R.R. Martin",
      series: "A Song of Ice and Fire", sequence: 1,
      description: "The noble houses of Westeros vie for the Iron Throne while ancient forces gather beyond the Wall.",
      hours: 33, files: 6,
    },
    {
      title: "A Clash of Kings",
      author: "George R.R. Martin",
      series: "A Song of Ice and Fire", sequence: 2,
      description: "The struggle for the Iron Throne intensifies as five kings claim dominion over Westeros.",
      hours: 37, files: 6,
    },
    {
      title: "A Storm of Swords",
      author: "George R.R. Martin",
      series: "A Song of Ice and Fire", sequence: 3,
      description: "The War of the Five Kings reaches its bloody climax with shocking betrayals and crushing defeats.",
      hours: 47, files: 8,
    },
    {
      title: "A Feast for Crows",
      author: "George R.R. Martin",
      series: "A Song of Ice and Fire", sequence: 4,
      description: "Westeros struggles to recover from war while new power players rise from the ruins.",
      hours: 33, files: 6,
    },
    {
      title: "A Dance with Dragons",
      author: "George R.R. Martin",
      series: "A Song of Ice and Fire", sequence: 5,
      description: "Events beyond the Wall and in Essos converge as winter truly begins to fall on the Seven Kingdoms.",
      hours: 48, files: 8,
    },

    // ── The Hitchhiker's Guide to the Galaxy ──────────────────────────────
    {
      title: "The Hitchhiker's Guide to the Galaxy",
      author: "Douglas Adams",
      series: "The Hitchhiker's Guide to the Galaxy", sequence: 1,
      description: "Moments before Earth is demolished, Arthur Dent is whisked into a bewildering universe of alien bureaucracy.",
      hours: 5, files: 2,
    },
    {
      title: "The Restaurant at the End of the Universe",
      author: "Douglas Adams",
      series: "The Hitchhiker's Guide to the Galaxy", sequence: 2,
      description: "Arthur Dent and his companions dine at Milliways, the most remarkable restaurant in the history of the universe.",
      hours: 5, files: 2,
    },
    {
      title: "Life, the Universe and Everything",
      author: "Douglas Adams",
      series: "The Hitchhiker's Guide to the Galaxy", sequence: 3,
      description: "Arthur Dent and Ford Prefect find themselves on a mission to stop the most appalling war in history.",
      hours: 5, files: 2,
    },
    {
      title: "So Long, and Thanks for All the Fish",
      author: "Douglas Adams",
      series: "The Hitchhiker's Guide to the Galaxy", sequence: 4,
      description: "Arthur Dent returns to an improbably reborn Earth, falls in love, and discovers the dolphins knew all along.",
      hours: 4, files: 2,
    },
    {
      title: "Mostly Harmless",
      author: "Douglas Adams",
      series: "The Hitchhiker's Guide to the Galaxy", sequence: 5,
      description: "The fifth book in the increasingly inaccurately named Hitchhiker's Trilogy. Things get worse.",
      hours: 5, files: 2,
    },

    // ── Discworld ─────────────────────────────────────────────────────────
    {
      title: "The Colour of Magic",
      author: "Terry Pratchett",
      series: "Discworld", sequence: 1,
      description: "The first Discworld novel: an inept wizard escorts the Disc's first tourist through deadly adventures.",
      hours: 8, files: 2,
    },
    {
      title: "Mort",
      author: "Terry Pratchett",
      series: "Discworld", sequence: 4,
      description: "Death takes on an apprentice named Mort, with consequences that threaten the fabric of reality.",
      hours: 9, files: 2,
    },
    {
      title: "Guards! Guards!",
      author: "Terry Pratchett",
      series: "Discworld", sequence: 8,
      description: "The hapless Night Watch of Ankh-Morpork must deal with a very real dragon terrorizing the city.",
      hours: 10, files: 3,
    },
    {
      title: "Small Gods",
      author: "Terry Pratchett",
      series: "Discworld", sequence: 13,
      description: "A great god finds himself trapped in the body of a tortoise with only one true believer left.",
      hours: 10, files: 3,
    },

    // ── The Stormlight Archive ─────────────────────────────────────────────
    {
      title: "The Way of Kings",
      author: "Brandon Sanderson",
      series: "The Stormlight Archive", sequence: 1,
      description: "A broken soldier, a young scholar, and an assassin are drawn into a world of ancient powers awakening.",
      hours: 45, files: 8,
    },
    {
      title: "Words of Radiance",
      author: "Brandon Sanderson",
      series: "The Stormlight Archive", sequence: 2,
      description: "The Knights Radiant must stand again as the Voidbringers return and the Everstorm approaches.",
      hours: 48, files: 8,
    },
    {
      title: "Oathbringer",
      author: "Brandon Sanderson",
      series: "The Stormlight Archive", sequence: 3,
      description: "The enemy's invasion has begun. Dalinar Kholin must unite the world's armies or see civilization fall.",
      hours: 57, files: 10,
    },
    {
      title: "Rhythm of War",
      author: "Brandon Sanderson",
      series: "The Stormlight Archive", sequence: 4,
      description: "A year into the war, Navani Kholin researches the tower's ancient fabrials as the battle rages on.",
      hours: 57, files: 10,
    },

    // ── The Witcher Saga ──────────────────────────────────────────────────
    {
      title: "Blood of Elves",
      author: "Andrzej Sapkowski",
      series: "The Witcher Saga", sequence: 1,
      description: "The first full-length Witcher novel: Geralt must protect Ciri, the child of destiny, from all sides.",
      hours: 10, files: 3,
    },
    {
      title: "Time of Contempt",
      author: "Andrzej Sapkowski",
      series: "The Witcher Saga", sequence: 2,
      description: "Geralt and Ciri face new dangers as a world war engulfs the Northern Kingdoms.",
      hours: 11, files: 3,
    },
    {
      title: "Baptism of Fire",
      author: "Andrzej Sapkowski",
      series: "The Witcher Saga", sequence: 3,
      description: "Geralt sets out across a war-ravaged landscape with an unlikely band to find Ciri.",
      hours: 11, files: 3,
    },

    // ── Standalone ────────────────────────────────────────────────────────
    {
      title: "Nineteen Eighty-Four",
      author: "George Orwell",
      description: "Big Brother is watching. Winston Smith dares to dream of rebellion against the totalitarian Party.",
      hours: 12, files: 3,
    },
    {
      title: "Brave New World",
      author: "Aldous Huxley",
      description: "A dystopian society engineered for happiness through conditioning, drugs, and the abolition of family.",
      hours: 9, files: 2,
    },
    {
      title: "Fahrenheit 451",
      author: "Ray Bradbury",
      description: "In a future where books are outlawed, fireman Guy Montag begins to question the world he burns for.",
      hours: 6, files: 2,
    },
    {
      title: "The Martian",
      author: "Andy Weir",
      description: "Stranded alone on Mars after a mission abort, astronaut Mark Watney must science his way to survival.",
      hours: 10, files: 3,
    },
    {
      title: "Project Hail Mary",
      author: "Andy Weir",
      description: "A lone astronaut wakes with no memory on a desperate solo mission that may be humanity's last hope.",
      hours: 16, files: 4,
    },
    {
      title: "Ender's Game",
      author: "Orson Scott Card",
      description: "Child prodigy Andrew Ender Wiggin is trained from birth to lead Earth's fleet against an alien threat.",
      hours: 11, files: 3,
    },
    {
      title: "Neuromancer",
      author: "William Gibson",
      description: "A washed-up hacker is hired for one last impossible job that takes him deep into the matrix.",
      hours: 9, files: 2,
    },
    {
      title: "The Left Hand of Darkness",
      author: "Ursula K. Le Guin",
      description: "A lone envoy visits a planet where humans have no fixed sex, and must navigate an alien politics of gender.",
      hours: 9, files: 2,
    },
    {
      title: "Flowers for Algernon",
      author: "Daniel Keyes",
      description: "A man with low intelligence undergoes an experimental procedure that transforms him into a genius.",
      hours: 9, files: 2,
    },
    {
      title: "Do Androids Dream of Electric Sheep?",
      author: "Philip K. Dick",
      description: "In a post-nuclear future, bounty hunter Rick Deckard hunts escaped androids indistinguishable from humans.",
      hours: 7, files: 2,
    },
    {
      title: "The Time Machine",
      author: "H.G. Wells",
      description: "A Victorian inventor travels to the year 802,701 and discovers a shattered, divided humanity.",
      hours: 5, files: 2,
    },
    {
      title: "Slaughterhouse-Five",
      author: "Kurt Vonnegut",
      description: "Billy Pilgrim becomes unstuck in time, reliving the Dresden firebombing and his alien abduction.",
      hours: 7, files: 2,
    },
    {
      title: "The Name of the Wind",
      author: "Patrick Rothfuss",
      description: "The legendary wizard Kvothe recounts his extraordinary life from orphaned street rat to university prodigy.",
      hours: 27, files: 5,
    },
    {
      title: "Good Omens",
      author: "Terry Pratchett & Neil Gaiman",
      description: "An angel and a demon who rather like Earth join forces to prevent the apocalypse from ruining everything.",
      hours: 12, files: 3,
    },
    {
      title: "American Gods",
      author: "Neil Gaiman",
      description: "Ex-convict Shadow Moon becomes the travelling companion of a god in a secret war between old and new powers.",
      hours: 19, files: 4,
    },
  ];

  // ── Create books with audio files ─────────────────────────────────────────
  let created = 0;
  for (const b of books) {
    const folderPath = `data/library/${slug(b.author)} - ${slug(b.title)}`;
    const totalSeconds = b.hours * 3600;

    await prisma.book.create({
      data: {
        title: b.title,
        libraryId: defaultLibrary.id,
        authorId: A[b.author],
        seriesId: b.series ? S[b.series] : null,
        sequence: b.sequence ?? null,
        description: b.description,
        duration: totalSeconds,
        folderPath,
        audioFiles: {
          create: makeFiles(folderPath, totalSeconds, b.files),
        },
      },
    });
    created++;
  }

  const seriesCount = books.filter((b) => b.series).length;
  const standaloneCount = books.filter((b) => !b.series).length;
  console.log(`\nSeeded ${created} books:`);
  console.log(`  ${seriesCount} in series  (${seriesNames.length} series total)`);
  console.log(`  ${standaloneCount} standalone`);
  console.log(`\nCredentials:`);
  console.log(`  admin / admin123  (ADMIN)`);
  console.log(`  demo  / demo123   (USER)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
