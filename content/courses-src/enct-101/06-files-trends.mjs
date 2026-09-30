import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Files and where programming is heading',
  kicker: 'ENCT 101 · Computer Programming · Chapters 9–10',
  subtitle: 'Variables vanish when the program ends; files remember. Then a glance at how programming grew up.',
  sections: [
    sec('why', '9.1', 'Why files', { eyebrow: 'Persistence',
      body: `<p>Variables live in RAM and disappear at exit. A ${term('file')} stores data on disk as a stream of bytes. <b>Text files</b> hold characters (readable, line-oriented); <b>binary files</b> hold raw bytes (compact, fast, not human-readable).</p>`,
      qs: [q('txt', 'Binary files differ from text files in that they…', ['Store raw bytes, not character lines.', 'Compact but unreadable.'], [['Cannot be read by programs.', 'They can.'], ['Are always smaller in RAM.', 'Unrelated.']])] }),
    sec('life', '9.2', 'The file lifecycle', { eyebrow: 'Open → use → close',
      body: `<p><code>FILE *f = fopen("data.txt", "r");</code> returns a pointer, or NULL if opening fails — always check. Modes: <code>r</code> read, <code>w</code> write (truncates!), <code>a</code> append, <code>r+</code> read/write; add <code>b</code> for binary. Then use <code>fprintf/fscanf</code> (formatted), <code>fgets/fputs</code> (lines), <code>fread/fwrite</code> (blocks), and finally <code>fclose(f)</code> so buffered data is flushed.</p>`,
      figs: [dia(`mode: sequence
[Program] as p
[C library buffer] as b
[Disk file] as d
p -> b : fopen("data.txt","w")
b -> d : create / truncate
p -> b : fprintf(f, "42")
p -> b : fclose(f)
b -> d : flush buffer to disk
@0 p -> b : fopen("data.txt","w")
@1 b -> d : create / truncate
@2 p -> b : fprintf(f, "42")
@3 p -> b : fclose(f)
@4 b -> d : flush buffer to disk`, 'Data sits in a buffer until fclose or a flush.', { caption: 'writing a file' })],
      qs: [q('w', 'Opening an existing file with mode “w” will…', ['Erase its contents.', 'Use “a” to keep and append.'], [['Append to it.', 'That is “a”.'], ['Open it read-only.', 'That is “r”.']])] }),
    sec('read', '9.3', 'Reading until the end', { eyebrow: 'Loops over files',
      body: `<p>Read in a loop until the function reports end of file: <code>while (fscanf(f, "%d", &amp;x) == 1)</code> stops when a value could not be read. Checking <code>feof</code> before reading causes the classic “last line processed twice” bug.</p>`,
      worked: [step('A file holds 5 numbers: 4 6 8 2 10. Read and sum.', '', { toc: 'Loop' }), step('4 + 6 + 8 + 2 + 10.', '30', { hero: true, toc: 'Sum' })],
      qs: [q('eof', 'The safest read loop tests…', ['The return value of the read function.', 'It says whether a value was obtained.'], [['feof before each read.', 'Causes an extra pass.'], ['The file size.', 'Not reliable.']])],
      probs: [pr('p-fs', '<p>A binary file stores 250 records of 24 bytes each. File size?</p>', '250 × 24 = <b>6000 bytes</b>.')] }),
    sec('seek', '9.4', 'Random access', { eyebrow: 'Jump around a file',
      body: `<p><code>fseek(f, offset, SEEK_SET)</code> moves the position; <code>ftell</code> reports it. With fixed-size records, record n starts at byte n × size, so any record can be read without scanning the rest.</p>`,
      qs: [q('sk', 'Records are 32 bytes. Record 10 (counting from 0) starts at byte…', ['320.', '10 × 32.'], [['32.', 'That is record 1.'], ['10.', 'Forgot the size.']])] }),
    sec('paradigm', '10.1', 'Paradigms', { eyebrow: 'Styles of programming',
      body: `<p><b>Procedural</b> (C): a program is functions acting on data. <b>Object-oriented</b> (C++, Java, Python): data and the functions that act on it are bundled in classes. <b>Functional</b>: programs are compositions of pure functions. Modern languages mix them.</p>`,
      figs: [dia(`direction: right
{Procedural C | struct Student | printStudent(s)} as a
{Object-oriented C++ | class Student: data | print()} as b
a -> b : evolves into`, 'Data and behaviour move together in OOP.', { caption: 'procedural → OOP' })],
      qs: [q('oop', 'The main idea of object-oriented programming is to…', ['Bundle data with the operations on it.', 'Encapsulation into classes.'], [['Avoid functions.', 'Methods are functions.'], ['Replace loops with gotos.', 'No.']])] }),
    sec('trend', '10.2', 'Recent trends', { eyebrow: 'Looking ahead',
      body: `<p>Memory-safe languages (Rust), scripting for data and AI (Python), web and mobile (JavaScript/Kotlin), WebAssembly, AI coding assistants, open-source libraries and version control as everyday tools. C remains the language of operating systems, embedded devices and compilers — learning it teaches how the machine really works.</p>`,
      qs: [q('why', 'C is still taught first because it…', ['Shows how memory, pointers and the machine really work.', 'Everything else is built on those ideas.'], [['Is the easiest language.', 'It is not.'], ['Has no bugs.', 'It has plenty.']])] }),
  ],
})
