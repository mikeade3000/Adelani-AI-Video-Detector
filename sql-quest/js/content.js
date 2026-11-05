/* SQL Quest — curriculum content: worlds, levels, lessons, challenges, bosses, badges.
 * Challenge types:
 *   query : write a query; graded by comparing the result set with the model solution
 *   fix   : a broken starter query must be repaired (graded like "query")
 *   quiz  : multiple choice
 *   short : short answer (accepted answers list)
 *   drag  : drag-and-drop items into bins (ER diagrams, keys, normal forms, relationships)
 * For DML/DDL challenges, `check` holds queries run AFTER the student's script; their output
 * is compared with the output after the model solution.
 */
window.SQ = window.SQ || {};

SQ.SANDBOX_SQL = `
CREATE TABLE departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  building TEXT
);
INSERT INTO departments VALUES
 (1,'Computer Science','Turing Hall'),
 (2,'Mathematics','Euler Block'),
 (3,'Physics','Curie Wing'),
 (4,'Business','Commerce House'),
 (5,'Fine Art','Studio Annex');

CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER,
  city TEXT,
  gpa REAL,
  dept_id INTEGER REFERENCES departments(id)
);
INSERT INTO students VALUES
 (1,'Amaka Obi',19,'Lagos',3.8,1),
 (2,'Tunde Bakare',21,'Ibadan',3.2,1),
 (3,'Zainab Musa',20,'Kano',3.9,2),
 (4,'Chinedu Eze',22,'Enugu',2.7,3),
 (5,'Fatima Bello',19,'Abuja',3.5,2),
 (6,'David Okafor',23,'Lagos',2.9,4),
 (7,'Grace Adeyemi',20,'Ibadan',3.6,1),
 (8,'Ibrahim Sani',21,'Kano',3.1,3),
 (9,'Ngozi Nwosu',22,'Enugu',3.4,4),
 (10,'Samuel Ajayi',19,'Lagos',3.0,1),
 (11,'Halima Yusuf',20,'Abuja',3.7,2),
 (12,'Kelechi Uche',24,'Port Harcourt',2.5,NULL);

CREATE TABLE courses (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  title TEXT NOT NULL,
  credits INTEGER,
  dept_id INTEGER REFERENCES departments(id)
);
INSERT INTO courses VALUES
 (1,'CSC101','Intro to Programming',3,1),
 (2,'CSC201','Databases',3,1),
 (3,'MTH101','Calculus I',4,2),
 (4,'MTH202','Linear Algebra',3,2),
 (5,'PHY101','Mechanics',4,3),
 (6,'BUS101','Principles of Management',2,4),
 (7,'CSC301','Computer Networks',3,1);

CREATE TABLE enrollments (
  student_id INTEGER REFERENCES students(id),
  course_id INTEGER REFERENCES courses(id),
  score INTEGER,
  PRIMARY KEY (student_id, course_id)
);
INSERT INTO enrollments VALUES
 (1,1,88),(1,2,92),(1,3,75),(2,1,64),(2,2,70),(3,3,95),(3,4,89),(4,5,58),(4,3,61),
 (5,3,82),(5,4,77),(6,6,69),(7,1,91),(7,2,85),(8,5,73),(9,6,80),(10,1,55),(10,2,62),
 (11,4,93),(11,3,88);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  owner TEXT NOT NULL,
  balance INTEGER NOT NULL CHECK (balance >= 0)
);
INSERT INTO accounts VALUES (1,'Amaka',5000),(2,'Tunde',3000),(3,'Zainab',7500);
`;

SQ.TOPICS = {
  tables: 'Tables, rows & columns', keys: 'Keys', select: 'SELECT', where: 'WHERE',
  orderby: 'ORDER BY', innerjoin: 'INNER JOIN', leftjoin: 'LEFT JOIN', relationships: 'Relationships',
  er: 'ER diagrams', normalization: 'Normalization', ddl: 'Creating tables',
  transactions: 'Transactions', indexes: 'Indexes', security: 'Security'
};

SQ.WORLDS = [
/* ───────────────────────────── WORLD 1 ───────────────────────────── */
{
  id: 'w1', num: 1, name: 'Data Village', focus: 'Data basics', icon: '🏡', color: 'w1',
  topics: 'Tables, rows, columns, keys',
  levels: [
    {
      id: 'w1l1', title: 'Tables, rows & columns', topic: 'tables',
      lesson: {
        body: `<p>A <b>database</b> stores data in <b>tables</b>. A table looks like a spreadsheet:</p>
<ul><li>A <b>column</b> (field) describes one kind of fact — e.g. <code>name</code> or <code>age</code>.</li>
<li>A <b>row</b> (record, tuple) is one complete item — e.g. one student.</li>
<li>Every value in a column has the same <b>data type</b> (INTEGER, TEXT, REAL…).</li></ul>
<p>To see everything in a table we use <code>SELECT *</code> — the star means “all columns”.</p>`,
        example: 'SELECT * FROM students;'
      },
      challenges: [
        { id: 'w1l1c1', type: 'quiz', title: 'Count the columns', xp: 20, par: 40, topic: 'tables',
          prompt: 'Look at the <code>students</code> table in the schema panel. How many <b>columns</b> does it have?',
          options: ['4', '5', '6', '12'], answer: 2,
          explain: 'students has id, name, age, city, gpa and dept_id — 6 columns. (12 is the number of rows.)',
          hints: ['Columns run across the top of a table. Count the field names.'] },
        { id: 'w1l1c2', type: 'query', title: 'Open the departments table', xp: 20, par: 60, topic: 'select',
          prompt: 'Return <b>every row and every column</b> from the <code>departments</code> table.',
          solution: 'SELECT * FROM departments;', starter: '',
          hints: ['Use the star (*) to mean “all columns”.', 'SELECT * FROM table_name;'] }
      ]
    },
    {
      id: 'w1l2', title: 'Choosing columns', topic: 'select',
      lesson: {
        body: `<p>Usually you only need some columns. List them after <code>SELECT</code>, separated by commas:</p>
<pre>SELECT name, gpa FROM students;</pre>
<p>The columns come back in the order you list them. SQL keywords are not case sensitive, but writing them in CAPITALS makes queries easier to read.</p>`,
        example: 'SELECT name, gpa FROM students;'
      },
      challenges: [
        { id: 'w1l2c1', type: 'query', title: 'Names and cities', xp: 20, par: 60, topic: 'select',
          prompt: 'Return the <code>name</code> and <code>city</code> of every student (in that column order).',
          solution: 'SELECT name, city FROM students;',
          hints: ['List the two columns after SELECT, separated by a comma.'] },
        { id: 'w1l2c2', type: 'short', title: 'Name that record', xp: 15, par: 30, topic: 'tables',
          prompt: 'One horizontal line of a table, holding all the facts about a single item, is called a ______.',
          accept: ['row', 'record', 'tuple', 'a row', 'a record', 'a tuple'],
          explain: 'A row is also called a record or a tuple.',
          hints: ['It is the opposite of a column.'] }
      ]
    },
    {
      id: 'w1l3', title: 'Keys', topic: 'keys',
      lesson: {
        body: `<p>A <b>primary key (PK)</b> uniquely identifies each row. It can never be NULL or repeated. In <code>students</code> the primary key is <code>id</code>.</p>
<p>A <b>foreign key (FK)</b> is a column that points to the primary key of another table. <code>students.dept_id</code> refers to <code>departments.id</code>, linking each student to a department.</p>
<p>A <b>composite key</b> uses more than one column: <code>enrollments</code> is keyed by <code>(student_id, course_id)</code>.</p>`,
        example: 'SELECT id, name, dept_id FROM students;'
      },
      challenges: [
        { id: 'w1l3c1', type: 'quiz', title: 'Spot the primary key', xp: 20, par: 40, topic: 'keys',
          prompt: 'Which column of <code>courses</code> is the best primary key?',
          options: ['title', 'credits', 'id', 'dept_id'], answer: 2,
          explain: 'id is unique and never NULL. Titles could repeat, many courses share credits, and dept_id is a foreign key.',
          hints: ['A primary key must be unique for every row.'] },
        { id: 'w1l3c2', type: 'drag', title: 'Sort the keys', xp: 30, par: 90, topic: 'keys',
          prompt: 'Drag each column into the right bin. (Tip: on a phone, tap an item then tap a bin.)',
          bins: ['Primary key', 'Foreign key', 'Ordinary attribute'],
          items: [
            { label: 'students.id', bin: 0 }, { label: 'departments.id', bin: 0 },
            { label: 'students.dept_id', bin: 1 }, { label: 'courses.dept_id', bin: 1 },
            { label: 'students.city', bin: 2 }, { label: 'courses.title', bin: 2 }, { label: 'students.gpa', bin: 2 }
          ],
          hints: ['Columns ending in _id that point to another table are usually foreign keys.'] }
      ]
    }
  ],
  boss: {
    id: 'w1boss', title: 'The Data Golem', timeLimit: 240, xp: 120,
    challenges: [
      { id: 'w1b1', type: 'query', title: 'Course catalogue', xp: 0, topic: 'select',
        prompt: 'Return the <code>title</code> and <code>credits</code> of every course.',
        solution: 'SELECT title, credits FROM courses;', hints: [] },
      { id: 'w1b2', type: 'fix', title: 'Fix the spell', xp: 0, topic: 'select',
        prompt: 'This query should list every department name, but it fails. Fix it.',
        starter: 'SELEC name FORM departments;', solution: 'SELECT name FROM departments;', hints: [] },
      { id: 'w1b3', type: 'short', title: 'The linking column', xp: 0, topic: 'keys',
        prompt: 'A column that refers to the primary key of another table is called a ______ key.',
        accept: ['foreign', 'foreign key', 'fk'], hints: [] },
      { id: 'w1b4', type: 'quiz', title: 'Composite keys', xp: 0, topic: 'keys',
        prompt: 'What is the primary key of <code>enrollments</code>?',
        options: ['score', 'student_id only', '(student_id, course_id)', 'It has no key'], answer: 2,
        explain: 'A student can take many courses and a course has many students, so the pair is the key.', hints: [] }
    ]
  }
},
/* ───────────────────────────── WORLD 2 ───────────────────────────── */
{
  id: 'w2', num: 2, name: 'Query Canyon', focus: 'SQL queries', icon: '🏜️', color: 'w2',
  topics: 'SELECT, WHERE, ORDER BY',
  levels: [
    {
      id: 'w2l1', title: 'Filtering with WHERE', topic: 'where',
      lesson: {
        body: `<p><code>WHERE</code> keeps only the rows that match a condition:</p>
<pre>SELECT name FROM students WHERE city = 'Kano';</pre>
<p>Text values go inside <b>single quotes</b>. Numbers do not: <code>WHERE age = 20</code>.</p>
<p>Comparison operators: <code>=  &lt;&gt;  &lt;  &gt;  &lt;=  &gt;=</code></p>`,
        example: "SELECT name, city FROM students WHERE city = 'Kano';"
      },
      challenges: [
        { id: 'w2l1c1', type: 'query', title: 'Lagos students', xp: 25, par: 60, topic: 'where',
          prompt: 'Return the <code>name</code> of every student whose city is <b>Lagos</b>.',
          solution: "SELECT name FROM students WHERE city = 'Lagos';",
          hints: ["Filter with WHERE city = '...'", 'Remember the single quotes around text.'] },
        { id: 'w2l1c2', type: 'fix', title: 'Missing quotes', xp: 25, par: 60, topic: 'where',
          prompt: 'This query should return students from Ibadan, but SQLite complains. Fix it.',
          starter: 'SELECT name FROM students WHERE city = Ibadan;',
          solution: "SELECT name FROM students WHERE city = 'Ibadan';",
          hints: ['Without quotes, SQL thinks Ibadan is a column name.'] }
      ]
    },
    {
      id: 'w2l2', title: 'AND, OR & ranges', topic: 'where',
      lesson: {
        body: `<p>Combine conditions with <code>AND</code> (both true) and <code>OR</code> (either true).</p>
<pre>SELECT name FROM students WHERE gpa &gt;= 3.5 AND age &lt; 21;</pre>
<p><code>BETWEEN a AND b</code> includes both ends. <code>IN ('Kano','Abuja')</code> matches any value in a list. <code>LIKE 'A%'</code> matches text starting with A.</p>
<p><b>Careful:</b> AND is evaluated before OR. Use brackets to make your intent clear.</p>`,
        example: "SELECT name, city FROM students WHERE city IN ('Kano','Abuja');"
      },
      challenges: [
        { id: 'w2l2c1', type: 'query', title: 'High-flyers', xp: 30, par: 90, topic: 'where',
          prompt: 'Return <code>name</code> and <code>gpa</code> of students with a GPA of <b>at least 3.5</b> who are <b>20 or older</b>.',
          solution: 'SELECT name, gpa FROM students WHERE gpa >= 3.5 AND age >= 20;',
          hints: ['You need two conditions joined with AND.', 'At least 3.5 means >= 3.5; 20 or older means age >= 20.'] },
        { id: 'w2l2c2', type: 'quiz', title: 'Operator precedence', xp: 20, par: 45, topic: 'where',
          prompt: "Which rows does <code>WHERE city = 'Kano' OR city = 'Abuja' AND gpa &gt; 3.6</code> return?",
          options: ['Kano or Abuja students with gpa > 3.6',
                    'All Kano students, plus Abuja students with gpa > 3.6',
                    'Only Abuja students', 'No rows'], answer: 1,
          explain: "AND binds tighter than OR, so it reads city='Kano' OR (city='Abuja' AND gpa>3.6).",
          hints: ['AND is evaluated before OR.'] }
      ]
    },
    {
      id: 'w2l3', title: 'Sorting with ORDER BY', topic: 'orderby',
      lesson: {
        body: `<p><code>ORDER BY</code> sorts results. <code>ASC</code> (default) is smallest first, <code>DESC</code> is largest first.</p>
<pre>SELECT name, gpa FROM students ORDER BY gpa DESC;</pre>
<p>Add <code>LIMIT n</code> to keep only the first n rows — great for “top 3” questions. You can sort by several columns: <code>ORDER BY city, name</code>.</p>`,
        example: 'SELECT name, age FROM students ORDER BY age DESC, name LIMIT 5;'
      },
      challenges: [
        { id: 'w2l3c1', type: 'query', title: 'Top three', xp: 30, par: 90, topic: 'orderby', ordered: true,
          prompt: 'Return <code>name</code> and <code>gpa</code> of the <b>three</b> students with the highest GPA, best first.',
          solution: 'SELECT name, gpa FROM students ORDER BY gpa DESC LIMIT 3;',
          hints: ['Sort by gpa DESC.', 'Add LIMIT 3 at the end.'] },
        { id: 'w2l3c2', type: 'fix', title: 'Broken sort', xp: 25, par: 60, topic: 'orderby', ordered: true,
          prompt: 'Fix this query so it lists names and ages from oldest to youngest (ties by name A→Z).',
          starter: 'SELECT name, age FROM students ORDER age DESC, name;',
          solution: 'SELECT name, age FROM students ORDER BY age DESC, name;',
          hints: ['The keyword is two words.'] }
      ]
    }
  ],
  boss: {
    id: 'w2boss', title: 'The Canyon Sphinx', timeLimit: 300, xp: 150,
    challenges: [
      { id: 'w2b1', type: 'query', title: 'Ibadan scholars', xp: 0, topic: 'where',
        prompt: 'Return the <code>name</code> of students from <b>Ibadan</b> with a GPA <b>greater than 3.3</b>.',
        solution: "SELECT name FROM students WHERE city = 'Ibadan' AND gpa > 3.3;", hints: [] },
      { id: 'w2b2', type: 'fix', title: 'Wrong operator', xp: 0, topic: 'where',
        prompt: 'Fix this query so it returns courses worth 3 or more credits.',
        starter: 'SELECT * FROM courses WHERE credits => 3;',
        solution: 'SELECT * FROM courses WHERE credits >= 3;', hints: [] },
      { id: 'w2b3', type: 'query', title: 'Sorted catalogue', xp: 0, topic: 'orderby', ordered: true,
        prompt: 'Return <code>title</code> and <code>credits</code> of all courses, most credits first, ties sorted by title A→Z.',
        solution: 'SELECT title, credits FROM courses ORDER BY credits DESC, title ASC;', hints: [] },
      { id: 'w2b4', type: 'quiz', title: 'Inclusive ranges', xp: 0, topic: 'where',
        prompt: '<code>WHERE age BETWEEN 20 AND 22</code> matches which ages?',
        options: ['21 only', '20 and 21', '20, 21 and 22', '21 and 22'], answer: 2,
        explain: 'BETWEEN includes both end values.', hints: [] }
    ]
  }
},
/* ───────────────────────────── WORLD 3 ───────────────────────────── */
{
  id: 'w3', num: 3, name: 'Join Jungle', focus: 'Joins and relationships', icon: '🌴', color: 'w3',
  topics: 'INNER/LEFT JOIN, one-to-many, many-to-many',
  levels: [
    {
      id: 'w3l1', title: 'INNER JOIN', topic: 'innerjoin',
      lesson: {
        body: `<p>A <b>JOIN</b> combines rows from two tables using a matching column. <code>INNER JOIN</code> keeps only rows that match on both sides:</p>
<pre>SELECT s.name, d.name
FROM students s
INNER JOIN departments d ON s.dept_id = d.id;</pre>
<p><code>s</code> and <code>d</code> are <b>aliases</b> — short names for the tables. The <code>ON</code> clause is the <b>join condition</b>. Forget it and every student is paired with every department!</p>`,
        example: 'SELECT s.name AS student, d.name AS department\nFROM students s\nJOIN departments d ON s.dept_id = d.id;'
      },
      challenges: [
        { id: 'w3l1c1', type: 'query', title: 'Who studies where', xp: 35, par: 120, topic: 'innerjoin',
          prompt: 'Return each student’s <code>name</code> and their department’s <code>building</code>. Only include students that have a department.',
          solution: 'SELECT s.name, d.building FROM students s INNER JOIN departments d ON s.dept_id = d.id;',
          hints: ['Join students to departments.', 'ON s.dept_id = d.id'] },
        { id: 'w3l1c2', type: 'fix', title: 'The exploding join', xp: 35, par: 90, topic: 'innerjoin',
          prompt: 'This query returns 60 rows instead of 11. Fix it so each student appears with their own department.',
          starter: 'SELECT s.name, d.name\nFROM students s\nJOIN departments d;',
          solution: 'SELECT s.name, d.name FROM students s JOIN departments d ON s.dept_id = d.id;',
          hints: ['A JOIN without a join condition pairs every row with every row.'] }
      ]
    },
    {
      id: 'w3l2', title: 'LEFT JOIN', topic: 'leftjoin',
      lesson: {
        body: `<p><code>LEFT JOIN</code> keeps <b>every</b> row from the left table, even with no match. Missing values on the right become <code>NULL</code>.</p>
<pre>SELECT d.name, s.name
FROM departments d
LEFT JOIN students s ON s.dept_id = d.id;</pre>
<p>Fine Art has no students, so it appears once with a NULL student. To find rows <i>without</i> a match, filter <code>WHERE right_table.column IS NULL</code>.</p>`,
        example: 'SELECT d.name AS department, s.name AS student\nFROM departments d\nLEFT JOIN students s ON s.dept_id = d.id;'
      },
      challenges: [
        { id: 'w3l2c1', type: 'query', title: 'Every department counts', xp: 35, par: 120, topic: 'leftjoin',
          prompt: 'Return every department <code>name</code> with the <code>name</code> of each of its students. Departments with no students must still appear.',
          solution: 'SELECT d.name, s.name FROM departments d LEFT JOIN students s ON s.dept_id = d.id;',
          hints: ['Start FROM departments and LEFT JOIN students.'] },
        { id: 'w3l2c2', type: 'query', title: 'Not enrolled', xp: 40, par: 150, topic: 'leftjoin',
          prompt: 'Return the <code>name</code> of every student who is <b>not enrolled</b> in any course.',
          solution: 'SELECT s.name FROM students s LEFT JOIN enrollments e ON e.student_id = s.id WHERE e.student_id IS NULL;',
          hints: ['LEFT JOIN students to enrollments.', 'Keep only rows where the enrollment side IS NULL.'] }
      ]
    },
    {
      id: 'w3l3', title: 'One-to-many & many-to-many', topic: 'relationships',
      lesson: {
        body: `<p><b>One-to-many (1:N):</b> one department has many students; each student belongs to one department. The FK lives on the “many” side (<code>students.dept_id</code>).</p>
<p><b>Many-to-many (M:N):</b> a student takes many courses and a course has many students. We need a <b>junction table</b> — <code>enrollments</code> — holding both foreign keys.</p>
<p>To cross an M:N relationship, join through the junction table:</p>
<pre>SELECT s.name, c.title
FROM students s
JOIN enrollments e ON e.student_id = s.id
JOIN courses c ON c.id = e.course_id;</pre>`,
        example: 'SELECT s.name, c.title, e.score\nFROM students s\nJOIN enrollments e ON e.student_id = s.id\nJOIN courses c ON c.id = e.course_id\nLIMIT 8;'
      },
      challenges: [
        { id: 'w3l3c1', type: 'drag', title: 'Classify relationships', xp: 35, par: 90, topic: 'relationships',
          prompt: 'Drag each pair into its relationship type.',
          bins: ['One-to-one (1:1)', 'One-to-many (1:N)', 'Many-to-many (M:N)'],
          items: [
            { label: 'Student ↔ Student ID card', bin: 0 }, { label: 'Country ↔ Capital city', bin: 0 },
            { label: 'Department ↔ Students', bin: 1 }, { label: 'Customer ↔ Orders', bin: 1 },
            { label: 'Students ↔ Courses', bin: 2 }, { label: 'Authors ↔ Books', bin: 2 }
          ],
          hints: ['Ask both directions: can one A have many B? Can one B have many A?'] },
        { id: 'w3l3c2', type: 'query', title: 'Database class list', xp: 40, par: 180, topic: 'relationships', ordered: true,
          prompt: 'Return the <code>name</code> and <code>score</code> of every student enrolled in the course titled <b>Databases</b>, highest score first.',
          solution: "SELECT s.name, e.score FROM students s JOIN enrollments e ON e.student_id = s.id JOIN courses c ON c.id = e.course_id WHERE c.title = 'Databases' ORDER BY e.score DESC;",
          hints: ['Join students → enrollments → courses.', "Filter WHERE c.title = 'Databases', then ORDER BY score DESC."] }
      ]
    }
  ],
  boss: {
    id: 'w3boss', title: 'The Jungle Hydra', timeLimit: 360, xp: 180,
    challenges: [
      { id: 'w3b1', type: 'query', title: 'Course owners', xp: 0, topic: 'innerjoin',
        prompt: 'Return each course <code>title</code> with the <code>name</code> of the department that runs it.',
        solution: 'SELECT c.title, d.name FROM courses c JOIN departments d ON d.id = c.dept_id;', hints: [] },
      { id: 'w3b2', type: 'query', title: 'Empty classrooms', xp: 0, topic: 'leftjoin',
        prompt: 'Return the <code>title</code> of every course that has <b>no</b> enrollments.',
        solution: 'SELECT c.title FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id WHERE e.course_id IS NULL;', hints: [] },
      { id: 'w3b3', type: 'quiz', title: 'Junction tables', xp: 0, topic: 'relationships',
        prompt: 'Why does the schema need the <code>enrollments</code> table?',
        options: ['To speed up queries', 'Students and courses have a many-to-many relationship',
                  'Courses have no primary key', 'SQLite cannot store scores in students'], answer: 1,
        explain: 'An M:N relationship is resolved with a junction table holding both foreign keys.', hints: [] },
      { id: 'w3b4', type: 'query', title: 'Lagos timetable', xp: 0, topic: 'relationships',
        prompt: 'Return <code>name</code> and course <code>title</code> for every enrollment of students who live in <b>Lagos</b>.',
        solution: "SELECT s.name, c.title FROM students s JOIN enrollments e ON e.student_id = s.id JOIN courses c ON c.id = e.course_id WHERE s.city = 'Lagos';", hints: [] }
    ]
  }
},
/* ───────────────────────────── WORLD 4 ───────────────────────────── */
{
  id: 'w4', num: 4, name: 'Design Citadel', focus: 'Database design', icon: '🏰', color: 'w4',
  topics: 'ER diagrams, normalization',
  levels: [
    {
      id: 'w4l1', title: 'ER diagrams', topic: 'er',
      lesson: {
        body: `<p>An <b>Entity–Relationship (ER) diagram</b> is a blueprint of a database.</p>
<ul><li><b>Entity</b> (rectangle): a thing we store data about — Student, Course.</li>
<li><b>Attribute</b> (oval / listed field): a property — name, credits. The key attribute is underlined.</li>
<li><b>Relationship</b> (diamond in Chen notation, a line in crow’s-foot): how entities connect — a Student <i>enrols in</i> a Course.</li>
<li><b>Cardinality</b>: 1:1, 1:N or M:N.</li></ul>
<p>Each entity usually becomes a table; each M:N relationship becomes a junction table whose own attributes (like <code>score</code>) live there.</p>`,
        example: "SELECT name, sql FROM sqlite_master WHERE type = 'table';"
      },
      challenges: [
        { id: 'w4l1c1', type: 'drag', title: 'Build the ER diagram', xp: 40, par: 120, topic: 'er',
          prompt: 'Build an ER diagram for a university: drag each attribute into the entity (or relationship) it belongs to.',
          bins: ['Student', 'Course', 'Enrols (relationship)'],
          items: [
            { label: 'matric_no (PK)', bin: 0 }, { label: 'full_name', bin: 0 }, { label: 'email', bin: 0 },
            { label: 'course_code (PK)', bin: 1 }, { label: 'title', bin: 1 }, { label: 'credits', bin: 1 },
            { label: 'score', bin: 2 }, { label: 'enrolled_on', bin: 2 }
          ],
          hints: ['A score belongs to a particular student in a particular course — so it lives on the relationship.'] },
        { id: 'w4l1c2', type: 'quiz', title: 'Chen notation', xp: 20, par: 40, topic: 'er',
          prompt: 'In Chen ER notation, what does a <b>diamond</b> represent?',
          options: ['An entity', 'An attribute', 'A relationship', 'A primary key'], answer: 2,
          explain: 'Rectangles are entities, ovals are attributes, diamonds are relationships.',
          hints: ['Entities are rectangles; attributes are ovals.'] }
      ]
    },
    {
      id: 'w4l2', title: 'Normalization', topic: 'normalization',
      lesson: {
        body: `<p><b>Normalization</b> removes redundancy so data is stored once and updates stay consistent.</p>
<ul><li><b>1NF</b>: every cell holds a single (atomic) value; no repeating groups like <code>"0803…, 0812…"</code>.</li>
<li><b>2NF</b>: 1NF, and every non-key column depends on the <i>whole</i> key (no partial dependency on part of a composite key).</li>
<li><b>3NF</b>: 2NF, and no non-key column depends on another non-key column (no transitive dependency).</li></ul>
<p>Example: in <code>enrollments(student_id, course_id, score, course_title)</code>, <code>course_title</code> depends only on <code>course_id</code> — a 2NF violation. Move it to <code>courses</code>.</p>`,
        example: 'SELECT * FROM enrollments LIMIT 5;'
      },
      challenges: [
        { id: 'w4l2c1', type: 'drag', title: 'Which rule is broken?', xp: 40, par: 120, topic: 'normalization',
          prompt: 'Each table breaks one normal form. Drag it to the form it violates.',
          bins: ['Breaks 1NF', 'Breaks 2NF', 'Breaks 3NF'],
          items: [
            { label: 'student(id, name, phones = "0803…, 0812…")', bin: 0 },
            { label: 'order(id, items = "pen; ruler; book")', bin: 0 },
            { label: 'enrollment(student_id, course_id, score, course_title)', bin: 1 },
            { label: 'order_line(order_id, product_id, qty, product_price)', bin: 1 },
            { label: 'student(id, name, dept_id, dept_building)', bin: 2 },
            { label: 'employee(id, name, postcode, city_of_postcode)', bin: 2 }
          ],
          hints: ['Lists inside one cell → 1NF.', 'Depends on part of a composite key → 2NF. Depends on another non-key column → 3NF.'] },
        { id: 'w4l2c2', type: 'quiz', title: 'Why normalize?', xp: 20, par: 45, topic: 'normalization',
          prompt: 'A department’s building is stored on every student row. The department moves. What problem appears?',
          options: ['Insertion anomaly only', 'An update anomaly — many rows must change or data becomes inconsistent',
                    'Nothing, it is fine', 'The primary key breaks'], answer: 1,
          explain: 'Redundant copies must all be updated together — an update anomaly. 3NF fixes it by storing building in departments.',
          hints: ['Think about how many rows hold the building.'] }
      ]
    },
    {
      id: 'w4l3', title: 'From design to tables', topic: 'ddl',
      lesson: {
        body: `<p>A design becomes real with <code>CREATE TABLE</code>:</p>
<pre>CREATE TABLE loans (
  id INTEGER PRIMARY KEY,
  student_id INTEGER REFERENCES students(id),
  book_title TEXT NOT NULL,
  loan_date TEXT
);</pre>
<p><code>PRIMARY KEY</code> marks the key, <code>REFERENCES</code> creates a foreign key, and <code>NOT NULL</code> forbids empty values.</p>`,
        example: "SELECT name, type, pk FROM pragma_table_info('enrollments');"
      },
      challenges: [
        { id: 'w4l3c1', type: 'query', title: 'Create the loans table', xp: 45, par: 180, topic: 'ddl', allow: ['ddl'],
          prompt: 'Create a table <code>loans</code> with columns: <code>id</code> (integer primary key), <code>student_id</code> (integer, foreign key to <code>students(id)</code>), <code>book_title</code> (text, not null) and <code>loan_date</code> (text).',
          solution: 'CREATE TABLE loans (id INTEGER PRIMARY KEY, student_id INTEGER REFERENCES students(id), book_title TEXT NOT NULL, loan_date TEXT);',
          check: [
            "SELECT lower(name) AS col, CASE WHEN upper(type) LIKE '%INT%' THEN 'INTEGER' WHEN upper(type) LIKE '%CHAR%' OR upper(type) LIKE '%TEXT%' OR upper(type) LIKE '%CLOB%' THEN 'TEXT' ELSE upper(type) END AS type, pk, CASE WHEN pk > 0 THEN 0 ELSE \"notnull\" END AS nn FROM pragma_table_info('loans') ORDER BY lower(name);",
            "SELECT lower(\"table\") AS ref_table, lower(\"from\") AS col, coalesce(lower(\"to\"), 'id') AS ref_col FROM pragma_foreign_key_list('loans');"
          ],
          hints: ['CREATE TABLE loans ( ... );', 'student_id INTEGER REFERENCES students(id)'] },
        { id: 'w4l3c2', type: 'short', title: 'Name the normal form', xp: 20, par: 40, topic: 'normalization',
          prompt: 'Which normal form removes <b>transitive</b> dependencies? (e.g. 1NF)',
          accept: ['3nf', 'third normal form', '3rd normal form', 'third', '3'],
          hints: ['It comes after 2NF.'] }
      ]
    }
  ],
  boss: {
    id: 'w4boss', title: 'The Architect’s Trial', timeLimit: 360, xp: 180,
    challenges: [
      { id: 'w4b1', type: 'drag', title: 'Library ER diagram', xp: 0, topic: 'er',
        prompt: 'Drag each attribute to its entity.',
        bins: ['Book', 'Member', 'Borrows (relationship)'],
        items: [
          { label: 'isbn (PK)', bin: 0 }, { label: 'author', bin: 0 },
          { label: 'member_id (PK)', bin: 1 }, { label: 'phone', bin: 1 },
          { label: 'due_date', bin: 2 }, { label: 'returned_on', bin: 2 }
        ], hints: [] },
      { id: 'w4b2', type: 'quiz', title: 'Spot the violation', xp: 0, topic: 'normalization',
        prompt: '<code>orders(order_id, customer_id, customer_email, total)</code> — key is order_id. Which form is broken?',
        options: ['1NF', '2NF', '3NF', 'None'], answer: 2,
        explain: 'customer_email depends on customer_id (a non-key column) — a transitive dependency, so 3NF is broken.', hints: [] },
      { id: 'w4b3', type: 'query', title: 'Clubs table', xp: 0, topic: 'ddl', allow: ['ddl'],
        prompt: 'Create a table <code>clubs</code> with <code>id</code> (integer primary key), <code>name</code> (text, not null) and <code>dept_id</code> (integer, foreign key to <code>departments(id)</code>).',
        solution: 'CREATE TABLE clubs (id INTEGER PRIMARY KEY, name TEXT NOT NULL, dept_id INTEGER REFERENCES departments(id));',
        check: [
          "SELECT lower(name) AS col, CASE WHEN upper(type) LIKE '%INT%' THEN 'INTEGER' WHEN upper(type) LIKE '%CHAR%' OR upper(type) LIKE '%TEXT%' OR upper(type) LIKE '%CLOB%' THEN 'TEXT' ELSE upper(type) END AS type, pk, CASE WHEN pk > 0 THEN 0 ELSE \"notnull\" END AS nn FROM pragma_table_info('clubs') ORDER BY lower(name);",
          "SELECT lower(\"table\"), lower(\"from\"), coalesce(lower(\"to\"), 'id') FROM pragma_foreign_key_list('clubs');"
        ], hints: [] },
      { id: 'w4b4', type: 'short', title: 'Atomic values', xp: 0, topic: 'normalization',
        prompt: 'Storing several phone numbers in one cell breaks which normal form? (e.g. 2NF)',
        accept: ['1nf', 'first normal form', '1st normal form', 'first', '1'], hints: [] }
    ]
  }
},
/* ───────────────────────────── WORLD 5 ───────────────────────────── */
{
  id: 'w5', num: 5, name: 'Vault Summit', focus: 'Advanced topics', icon: '🏔️', color: 'w5',
  topics: 'Transactions, indexes, security',
  levels: [
    {
      id: 'w5l1', title: 'Transactions', topic: 'transactions',
      lesson: {
        body: `<p>A <b>transaction</b> groups statements so they succeed or fail <b>together</b>.</p>
<pre>BEGIN;
UPDATE accounts SET balance = balance - 500 WHERE id = 1;
UPDATE accounts SET balance = balance + 500 WHERE id = 2;
COMMIT;</pre>
<p><code>COMMIT</code> saves the changes; <code>ROLLBACK</code> undoes everything since <code>BEGIN</code>.</p>
<p>Transactions guarantee <b>ACID</b>: <b>A</b>tomicity (all or nothing), <b>C</b>onsistency (rules hold), <b>I</b>solation (no interference), <b>D</b>urability (committed data survives crashes).</p>`,
        example: 'SELECT * FROM accounts;'
      },
      challenges: [
        { id: 'w5l1c1', type: 'query', title: 'Safe transfer', xp: 45, par: 180, topic: 'transactions', allow: ['dml', 'tx'],
          requireKeywords: ['BEGIN', 'COMMIT'],
          prompt: 'Inside a transaction (<code>BEGIN … COMMIT</code>), move <b>1000</b> from account <b>1</b> (Amaka) to account <b>2</b> (Tunde).',
          solution: 'BEGIN; UPDATE accounts SET balance = balance - 1000 WHERE id = 1; UPDATE accounts SET balance = balance + 1000 WHERE id = 2; COMMIT;',
          check: ['SELECT id, owner, balance FROM accounts ORDER BY id;'],
          hints: ['Two UPDATE statements between BEGIN; and COMMIT;', 'SET balance = balance - 1000 WHERE id = 1'] },
        { id: 'w5l1c2', type: 'quiz', title: 'ACID test', xp: 20, par: 40, topic: 'transactions',
          prompt: 'The power fails after the first UPDATE of a transfer but before COMMIT. Which ACID property guarantees the money is not lost?',
          options: ['Atomicity', 'Consistency', 'Isolation', 'Durability'], answer: 0,
          explain: 'Atomicity: an unfinished transaction is rolled back completely.',
          hints: ['All or nothing.'] }
      ]
    },
    {
      id: 'w5l2', title: 'Indexes', topic: 'indexes',
      lesson: {
        body: `<p>An <b>index</b> is like the index at the back of a book: it lets the database find rows without scanning the whole table.</p>
<pre>CREATE INDEX idx_students_city ON students(city);</pre>
<p>Index columns you often search, join or sort on. The trade-off: indexes use space and make <code>INSERT</code>/<code>UPDATE</code> slower, because the index must be updated too.</p>`,
        example: "EXPLAIN QUERY PLAN SELECT * FROM students WHERE city = 'Kano';"
      },
      challenges: [
        { id: 'w5l2c1', type: 'query', title: 'Speed up city search', xp: 40, par: 120, topic: 'indexes', allow: ['ddl'],
          prompt: 'Students are searched by city all the time. Create an index on <code>students(city)</code> (any index name).',
          solution: 'CREATE INDEX idx_students_city ON students(city);',
          check: ["SELECT m.tbl_name, ii.name FROM sqlite_master m, pragma_index_info(m.name) ii WHERE m.type = 'index' AND m.sql IS NOT NULL ORDER BY 1, 2;"],
          hints: ['CREATE INDEX some_name ON table(column);'] },
        { id: 'w5l2c2', type: 'quiz', title: 'Index trade-offs', xp: 20, par: 40, topic: 'indexes',
          prompt: 'What is the main cost of adding many indexes to a table?',
          options: ['SELECT queries become slower', 'INSERT/UPDATE/DELETE become slower and storage grows',
                    'Primary keys stop working', 'Tables can no longer be joined'], answer: 1,
          explain: 'Every write must also update each index, and indexes take space.',
          hints: ['Think about what happens when a row is inserted.'] }
      ]
    },
    {
      id: 'w5l3', title: 'Database security', topic: 'security',
      lesson: {
        body: `<p><b>SQL injection</b> happens when user input is glued into a query string:</p>
<pre>"SELECT * FROM users WHERE name = '" + input + "'"</pre>
<p>Input like <code>' OR '1'='1</code> changes the query’s meaning. The fix is <b>parameterised queries</b> (prepared statements): <code>WHERE name = ?</code> with the value passed separately.</p>
<p>Also follow <b>least privilege</b>: give each account only the permissions it needs (<code>GRANT SELECT ON courses TO reporter;</code>, <code>REVOKE</code> to remove), and always <b>hash passwords</b> — never store them as plain text.</p>`,
        example: "SELECT name FROM students WHERE name = 'x' OR '1'='1';"
      },
      challenges: [
        { id: 'w5l3c1', type: 'quiz', title: 'Stop the injection', xp: 25, par: 45, topic: 'security',
          prompt: 'What is the most reliable defence against SQL injection?',
          options: ['Hiding error messages', 'Parameterised queries / prepared statements',
                    'Using longer table names', 'Only allowing SELECT'], answer: 1,
          explain: 'Parameters keep data separate from SQL code, so input cannot change the query.',
          hints: ['Keep data separate from code.'] },
        { id: 'w5l3c2', type: 'short', title: 'Give permission', xp: 20, par: 40, topic: 'security',
          prompt: 'Which SQL keyword gives a user permission on a table (e.g. ___ SELECT ON courses TO reporter)?',
          accept: ['grant'], hints: ['Its opposite is REVOKE.'] }
      ]
    }
  ],
  boss: {
    id: 'w5boss', title: 'The Vault Dragon', timeLimit: 360, xp: 220,
    challenges: [
      { id: 'w5b1', type: 'query', title: 'Atomic deposit', xp: 0, topic: 'transactions', allow: ['dml', 'tx'],
        requireKeywords: ['BEGIN', 'COMMIT'],
        prompt: 'In a transaction, move <b>2500</b> from account <b>3</b> (Zainab) to account <b>1</b> (Amaka).',
        solution: 'BEGIN; UPDATE accounts SET balance = balance - 2500 WHERE id = 3; UPDATE accounts SET balance = balance + 2500 WHERE id = 1; COMMIT;',
        check: ['SELECT id, balance FROM accounts ORDER BY id;'], hints: [] },
      { id: 'w5b2', type: 'query', title: 'Course code index', xp: 0, topic: 'indexes', allow: ['ddl'],
        prompt: 'Create an index on <code>enrollments(course_id)</code>.',
        solution: 'CREATE INDEX idx_enr_course ON enrollments(course_id);',
        check: ["SELECT m.tbl_name, ii.name FROM sqlite_master m, pragma_index_info(m.name) ii WHERE m.type = 'index' AND m.sql IS NOT NULL ORDER BY 1, 2;"], hints: [] },
      { id: 'w5b3', type: 'quiz', title: 'Least privilege', xp: 0, topic: 'security',
        prompt: 'A reporting tool only reads course data. Which permission should its account get?',
        options: ['ALL PRIVILEGES on the database', 'SELECT on courses only', 'DELETE on courses', 'Admin role'], answer: 1,
        explain: 'Least privilege: only what it needs — read access to courses.', hints: [] },
      { id: 'w5b4', type: 'quiz', title: 'Rollback', xp: 0, topic: 'transactions',
        prompt: 'What does <code>ROLLBACK</code> do?',
        options: ['Saves all changes', 'Undoes changes made since BEGIN', 'Deletes the table', 'Restarts the server'], answer: 1, hints: [] }
    ]
  }
}
];

/* Badges. `rule` is evaluated by the engine (see app.js → checkBadges). Admins can edit name/icon/description,
 * disable a badge, or add new XP-threshold badges. */
SQ.DEFAULT_BADGES = [
  { id: 'first_query', icon: '🔍', name: 'First Query', desc: 'Pass your first SQL challenge.', rule: { type: 'firstType', value: 'query' } },
  { id: 'first_join', icon: '🔗', name: 'First JOIN', desc: 'Pass a challenge using a JOIN.', rule: { type: 'join' } },
  { id: 'bug_squasher', icon: '🐞', name: 'Bug Squasher', desc: 'Fix your first broken query.', rule: { type: 'firstType', value: 'fix' } },
  { id: 'architect', icon: '📐', name: 'Architect', desc: 'Complete a drag-and-drop design mission.', rule: { type: 'firstType', value: 'drag' } },
  { id: 'boss_slayer', icon: '⚔️', name: 'Boss Slayer', desc: 'Defeat your first boss battle.', rule: { type: 'bosses', value: 1 } },
  { id: 'grand_master', icon: '👑', name: 'Grand Master', desc: 'Defeat all five bosses.', rule: { type: 'bosses', value: 5 } },
  { id: 'streak3', icon: '🔥', name: 'On Fire', desc: 'Practise three days in a row.', rule: { type: 'streak', value: 3 } },
  { id: 'streak10', icon: '🌋', name: 'Ten-Day Streak', desc: 'Practise ten days in a row.', rule: { type: 'streak', value: 10 } },
  { id: 'perfectionist', icon: '💎', name: 'Perfectionist', desc: 'Pass 10 challenges on the first try.', rule: { type: 'firstTry', value: 10 } },
  { id: 'speedster', icon: '⚡', name: 'Speedster', desc: 'Earn 5 speed bonuses.', rule: { type: 'speed', value: 5 } },
  { id: 'xp500', icon: '⭐', name: 'Rising Star', desc: 'Reach 500 XP.', rule: { type: 'xp', value: 500 } },
  { id: 'xp1500', icon: '🌟', name: 'Data Hero', desc: 'Reach 1500 XP.', rule: { type: 'xp', value: 1500 } },
  { id: 'reviewer', icon: '🧐', name: 'Peer Reviewer', desc: 'Review a classmate’s query.', rule: { type: 'reviews', value: 1 } },
  { id: 'team_player', icon: '🤝', name: 'Team Player', desc: 'Complete a team mission.', rule: { type: 'team', value: 1 } }
];

/* Team missions — the team leader submits; every member earns the XP. */
SQ.TEAM_MISSIONS = [
  { id: 'tm1', type: 'query', title: 'Department report', xp: 60, topic: 'innerjoin', worldId: 'w3',
    prompt: 'As a team, return every student’s <code>name</code>, department <code>name</code> and <code>gpa</code> for students with a GPA above 3.3, highest GPA first.',
    solution: 'SELECT s.name, d.name, s.gpa FROM students s JOIN departments d ON d.id = s.dept_id WHERE s.gpa > 3.3 ORDER BY s.gpa DESC;', ordered: true,
    hints: ['Join students to departments, filter on gpa, then sort.'] },
  { id: 'tm2', type: 'query', title: 'Course roll call', xp: 60, topic: 'relationships', worldId: 'w3',
    prompt: 'Return each course <code>code</code> with the <code>name</code> of each enrolled student and their <code>score</code>, for scores of 80 or more.',
    solution: 'SELECT c.code, s.name, e.score FROM courses c JOIN enrollments e ON e.course_id = c.id JOIN students s ON s.id = e.student_id WHERE e.score >= 80;',
    hints: ['Three tables: courses, enrollments, students.'] }
];
