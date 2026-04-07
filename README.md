# MINKOWSKI

> **English** · [Italiano](#italiano)

---

## English

MINKOWSKI is a minimalist programming language in which **lines are simultaneously code and memory**. Every line of a MINKOWSKI program has a 1-based index that acts both as its address in the program counter and as a slot in the program's writable memory. Code is data, and data is code.

---

### Contents

- [Execution Model](#execution-model)
- [Instructions](#instructions)
  - [Comment Block — `#`](#comment-block--)
  - [Output Toggle — `~`](#output-toggle--)
  - [Empty Literal — `%`](#empty-literal--)
  - [Return / Halt — `*`](#return--halt--)
  - [Input — empty line](#input--empty-line)
  - [Subroutine Call — `@N`](#subroutine-call--n)
  - [Output — `>...`](#output---)
  - [Conditional Jump — `?cond:@N`](#conditional-jump--condn)
  - [Line Mutation — `#(N:expr)`](#line-mutation--nexpr)
  - [Line Reference — `#N`](#line-reference--n)
- [Expressions](#expressions)
- [Halt Conditions](#halt-conditions)
- [Patterns & Idioms](#patterns--idioms)
- [Complete Examples](#complete-examples)
- [C Compiler](#c-compiler)

---

### Execution Model

```
┌─────────────────────────────────────────────────┐
│  Line 1  │  "Hello, World!"  ← code OR data     │
│  Line 2  │  >Hello, World!   ← instruction      │
│  Line 3  │  0                ← variable          │
│  Line 4  │  #(3:#3 + 1)      ← mutates line 3   │
│   ...    │                                        │
└─────────────────────────────────────────────────┘
```

- Lines are **1-indexed**.
- The **program counter** (PC) starts at line 1 and advances by 1 after each instruction, unless a jump changes it.
- Any line can be **read** as a value via `#N`.
- Any line can be **written** at runtime via `#(N:expr)`.
- Lines that do not match any instruction syntax are treated as **data** (they are skipped by the PC but remain readable as memory).
- The program **halts** when the PC falls outside the valid range `[1, line_count]`, or when `*` is executed with an empty return stack.

---

### Instructions

All instructions are matched on the **trimmed** content of a line (leading/trailing whitespace is ignored), except for `>` which is matched on the raw line (so the character immediately after `>` is part of the output expression, without trimming).

---

#### Comment Block — `#`

```
#
```

A line containing only `#` **toggles** the ignored-block state.

- The first `#` encountered **opens** a comment block. Every subsequent line (including other instructions) is skipped.
- The next `#` **closes** the block. Execution resumes on the line after it.
- Comment blocks can span any number of lines.
- `#` cannot be nested.

```
>This prints.
#
>This is ignored.
>This is also ignored.
#
>This prints again.
```

---

#### Output Toggle — `~`

```
~
```

A line containing only `~` flips the **output-enabled** flag.

- Output starts **enabled**.
- When disabled, `>` instructions are still executed (expressions are still evaluated and references resolved), but nothing is printed.
- Toggling `~` twice restores normal output.

```
>Visible
~
>Hidden
>Also hidden
~
>Visible again
```

---

#### Empty Literal — `%`

```
%
```

A line containing only `%` is a **no-op** data line. It is useful as an explicit placeholder that will never trigger the input mechanism (which activates on truly empty lines). The PC advances past it with no side effects.

---

#### Return / Halt — `*`

```
*
```

A line containing only `*` performs one of two actions depending on the call stack:

| Call stack state | Effect |
|---|---|
| Non-empty | Pops the top address and jumps to it (return from subroutine) |
| Empty | Halts the program immediately |

`*` is the only explicit halt instruction. It is also the sole return mechanism from subroutines called with `@N`.

---

#### Input — empty line

```
(empty)
```

An **empty line** (or a line that trims to empty) pauses execution and requests user input. The input string replaces the content of **that same line**. Execution then continues on the next line.

Because the line stores the input, it can be read back later via `#N` where N is the line number of the input slot.

```
1: >Enter your name:
2:                        ← empty: reads input, stores it in line 2
3: >Hello, #2!            ← prints "Hello, <input>!"
```

After input, line 2 contains what the user typed. `#2` in line 3 expands to that value.

---

#### Subroutine Call — `@N`

```
@N
```

Pushes `(current_pc + 1)` onto the return stack and jumps to line N. Execution continues from line N. When `*` is reached, it pops the return address and jumps back.

- Subroutines can be nested to the depth of the stack (default 4096 levels).
- `@N` is **always** a call (not a plain jump) — the return address is always pushed.

```
1: @5          ← calls subroutine at line 5; pushes 2 on stack
2: >Returned!
3: *           ← halts (stack is empty now)
4: %
5: >Inside subroutine
6: *           ← returns to line 2
```

Output:
```
Inside subroutine
Returned!
```

---

#### Output — `>`

```
>expression
```

Evaluates `expression` (after resolving `#N` references) and prints the result followed by a newline. The `>` character is the first character of the raw line — no space is required between `>` and the expression.

If output is disabled (see `~`), the expression is still evaluated but nothing is printed.

```
>Hello, World!
>42
>1 + 1          ← prints "2" (numeric expression)
>#5             ← prints the content of line 5
>Result: #10    ← string with embedded reference
```

---

#### Conditional Jump — `?cond:@N`

```
?condition:@N
```

Evaluates `condition` (after resolving `#N` references). If the result is **truthy**, jumps to line N. Otherwise, advances to the next line.

**Truthy** means:
- A non-zero number.
- A non-empty string (when the condition cannot be evaluated as a numeric expression).

The `:@N` part must appear at the end of the line. The condition is everything between `?` and the last `:@`.

```
#(10:0)
>Start
#(10:#10 + 1)
?#10 < 5:@3       ← loops back to line 3 while counter < 5
>Done
```

---

#### Line Mutation — `#(N:expr)`

```
#(N:expr)
```

Evaluates `expr` (after resolving `#N` references inside it) and stores the result in line N, replacing its content entirely. This is MINKOWSKI's assignment statement and is the mechanism for self-modifying code.

- N must be a positive integer.
- If N is beyond the current last line, the program is extended with empty lines up to N.
- `expr` can contain `#M` references which are resolved before evaluation.
- The result is the evaluated value (numeric or string).

```
#(20:0)          ← line 20 = "0"   (initialize variable)
#(20:#20 + 1)    ← line 20 = "1"   (increment)
#(20:#20 + 1)    ← line 20 = "2"
>#20             ← prints "2"
```

Variables are typically stored in lines that are **not** executed by the PC (high-numbered lines beyond the program code), to avoid accidentally overwriting instructions.

---

#### Line Reference — `#N`

```
#N
```

`#N` inside any expression, output, condition, or mutation **expands to the current content of line N**, recursively. Resolution depth is capped at 64 to prevent infinite loops.

To include a literal `#N` in output without expansion, escape it with a backslash: `\#N`.

```
>#5           ← expands to the content of line 5
>#5 + 1       ← expands line 5, then adds 1 (if numeric)
>Value: \#5   ← prints literal "Value: #5"
```

References can be chained: if line 5 contains `#10`, and line 10 contains `42`, then `>#5` prints `42`.

---

### Expressions

When the resolved value of a string consists **entirely** of: digits, spaces, `+`, `-`, `*`, `/`, `&`, `|`, `!`, `(`, `)`, `.`, `<`, `>`, `~`, `=` — it is treated as a **numeric expression** and evaluated arithmetically.

| MINKOWSKI | Meaning |
|---|---|
| `+` `-` `*` `/` | Arithmetic |
| `&` or `&&` | Logical AND |
| `\|` or `\|\|` | Logical OR |
| `!` | Logical NOT |
| `=` | Equality (`==`) |
| `~` | Not-equal (`!=`) |
| `<` `>` `<=` `>=` | Comparison |
| `(` `)` | Grouping |
| `.` | Decimal point |

Boolean results (`true`/`false`) are returned as `1`/`0`.

If the string contains any character outside the allowed set, it is treated as a **plain string** and returned as-is.

---

### Halt Conditions

The program halts in any of these situations:

1. **PC out of range**: the program counter advances past the last line (or below line 1).
2. **`*` with empty stack**: `*` is executed when there is nothing on the return stack.
3. **Guard limit** (interpreter-dependent): some implementations stop after 1 000 000 steps to prevent infinite loops.

---

### Patterns & Idioms

#### Variables

Store values in lines well beyond the code. Use `#(N:value)` to write and `#N` to read.

```
#(100:0)    ← variable at line 100
#(101:1)    ← another variable
#(100:#100 + #101)   ← add and store
```

#### Loops

```
#(50:0)              ← counter = 0
>#50                 ← print counter  (line 2)
#(50:#50 + 1)        ← counter++
?#50 < 10:@2         ← if counter < 10, jump back to line 2
```

#### Unconditional Jump

There is no plain `goto` in MINKOWSKI. Use a condition that is always true:

```
?1:@N
```

#### Named Subroutines

Place subroutines at the end of the program or in high-numbered lines. Call them with `@N` and end them with `*`.

```
1: @20        ← call subroutine "greet"
2: >Done.
3: *
…
20: >Hello!   ← subroutine body
21: *         ← return
```

#### Computed Jumps

Since `@N` requires a literal number, computed jumps are not directly supported. Workaround: use `#(N:@target)` to rewrite a jump instruction, then fall through to it.

#### Suppressing Output During Computation

```
~
#(50:#50 * #50)   ← compute without printing
~
>#50              ← now print the result
```

---

### Complete Examples

#### Hello, World!

```
>Hello, World!
```

---

#### Counter (1 to 5)

```
#(10:1)
>Counter: #10
#(10:#10 + 1)
?#10 <= 5:@2
>Done.
```

Output:
```
Counter: 1
Counter: 2
Counter: 3
Counter: 4
Counter: 5
Done.
```

---

#### Fibonacci Sequence (first 10 terms)

Variables at lines 20, 21, 22, 23 — safely above the 10-line program.

```
>Fibonacci:
#(20:0)
#(21:1)
#(22:0)
>#20
#(23:#20 + #21)
#(20:#21)
#(21:#23)
#(22:#22 + 1)
?#22 < 10:@5
```

Output:
```
Fibonacci:
0
1
1
2
3
5
8
13
21
34
```

---

#### Interactive Input

```
>What is your name?
                        ← empty line: reads input into line 2
>Hello, #2!
```

---

#### Subroutine Call

```
#(50:0)
>Before call: #50
@7
>After call: #50
*
%
#(50:#50 + 10)
>Subroutine ran. #50
*
```

---

### C Compiler

This repository includes `minkc`, a compiler that translates MINKOWSKI source files into self-contained C programs.

#### Build

```bash
cd minkowski-compiler
make
```

Requires GCC (or any C11-compatible compiler) and `make`.

#### Usage

```bash
./minkc program.mink          # outputs program.c
./minkc program.mink -o out.c # specify output file
gcc -O2 out.c -o program -lm
./program
```

#### How It Works

Because MINKOWSKI allows self-modifying code (`#(N:...)`), the compiler cannot eliminate the runtime entirely. Instead, `minkc` generates a standalone C file that embeds:

1. **The initial memory** — all source lines as a string array.
2. **A lightweight runtime** — reference resolver, recursive-descent expression evaluator, call stack, and interpreter loop.

The generated C file has no external dependencies beyond the standard C library and `libm`. It is compiled and run like any other C program.

---

---

## Italiano

MINKOWSKI è un linguaggio di programmazione minimalista in cui **le righe sono contemporaneamente codice e memoria**. Ogni riga di un programma MINKOWSKI ha un indice a base 1 che funge sia da indirizzo nel contatore di programma sia da slot nella memoria scrivibile del programma. Il codice è dato, e il dato è codice.

---

### Indice

- [Modello di esecuzione](#modello-di-esecuzione)
- [Istruzioni](#istruzioni)
  - [Blocco commento — `#`](#blocco-commento--)
  - [Toggle output — `~`](#toggle-output--)
  - [Letterale vuoto — `%`](#letterale-vuoto--)
  - [Return / Halt — `*`](#return--halt---1)
  - [Input — riga vuota](#input--riga-vuota)
  - [Chiamata a subroutine — `@N`](#chiamata-a-subroutine--n)
  - [Output — `>...`](#output----1)
  - [Salto condizionale — `?cond:@N`](#salto-condizionale--condn)
  - [Mutazione di riga — `#(N:expr)`](#mutazione-di-riga--nexpr)
  - [Riferimento a riga — `#N`](#riferimento-a-riga--n)
- [Espressioni](#espressioni)
- [Condizioni di halt](#condizioni-di-halt)
- [Pattern e idiomi](#pattern-e-idiomi)
- [Esempi completi](#esempi-completi)
- [Compilatore C](#compilatore-c)

---

### Modello di esecuzione

```
┌─────────────────────────────────────────────────┐
│  Riga 1  │  "Ciao, mondo!"   ← codice O dato    │
│  Riga 2  │  >Ciao, mondo!    ← istruzione       │
│  Riga 3  │  0                ← variabile         │
│  Riga 4  │  #(3:#3 + 1)      ← muta la riga 3   │
│   ...    │                                        │
└─────────────────────────────────────────────────┘
```

- Le righe sono **indicizzate a partire da 1**.
- Il **contatore di programma** (PC) parte dalla riga 1 e avanza di 1 dopo ogni istruzione, salvo che un salto non lo cambi.
- Qualsiasi riga può essere **letta** come valore tramite `#N`.
- Qualsiasi riga può essere **scritta** a runtime tramite `#(N:expr)`.
- Le righe che non corrispondono alla sintassi di nessuna istruzione sono trattate come **dato** (vengono saltate dal PC ma rimangono leggibili come memoria).
- Il programma **termina** quando il PC esce dall'intervallo valido `[1, numero_righe]`, oppure quando `*` viene eseguito con lo stack di ritorno vuoto.

---

### Istruzioni

Tutte le istruzioni vengono riconosciute sul contenuto **trimmed** della riga (gli spazi iniziali e finali sono ignorati), tranne `>` che viene riconosciuta sulla riga grezza (il carattere immediatamente dopo `>` fa parte dell'espressione di output, senza trim).

---

#### Blocco commento — `#`

```
#
```

Una riga che contiene solo `#` **attiva/disattiva** lo stato di blocco ignorato.

- Il primo `#` incontrato **apre** un blocco commento. Ogni riga successiva (incluse le altre istruzioni) viene saltata.
- Il successivo `#` **chiude** il blocco. L'esecuzione riprende dalla riga successiva.
- I blocchi commento possono estendersi su qualsiasi numero di righe.
- I blocchi commento non sono annidabili.

```
>Questa stampa.
#
>Questa è ignorata.
>Anche questa è ignorata.
#
>Questa stampa di nuovo.
```

---

#### Toggle output — `~`

```
~
```

Una riga che contiene solo `~` inverte il flag **output abilitato**.

- L'output parte **abilitato**.
- Quando disabilitato, le istruzioni `>` vengono comunque eseguite (le espressioni vengono valutate e i riferimenti risolti), ma nulla viene stampato.
- Alternare `~` due volte ripristina l'output normale.

```
>Visibile
~
>Nascosta
>Anche nascosta
~
>Visibile di nuovo
```

---

#### Letterale vuoto — `%`

```
%
```

Una riga che contiene solo `%` è una **istruzione nulla** (no-op). È utile come segnaposto esplicito che non attiverà mai il meccanismo di input (che si attiva sulle righe veramente vuote). Il PC avanza oltre essa senza effetti collaterali.

---

#### Return / Halt — `*`

```
*
```

Una riga che contiene solo `*` esegue una di due azioni in base allo stack di chiamata:

| Stato dello stack | Effetto |
|---|---|
| Non vuoto | Estrae l'indirizzo in cima e salta ad esso (ritorno da subroutine) |
| Vuoto | Termina il programma immediatamente |

`*` è l'unica istruzione di halt esplicita. È anche l'unico meccanismo di ritorno dalle subroutine chiamate con `@N`.

---

#### Input — riga vuota

```
(vuota)
```

Una **riga vuota** (o una riga che dopo il trim risulta vuota) sospende l'esecuzione e richiede input all'utente. La stringa digitata sostituisce il contenuto di **quella stessa riga**. L'esecuzione riprende poi sulla riga successiva.

Poiché la riga memorizza l'input, il valore può essere riletto in seguito tramite `#N`, dove N è il numero della riga di input.

```
1: >Come ti chiami?
2:                       ← vuota: legge input, lo memorizza in riga 2
3: >Ciao, #2!            ← stampa "Ciao, <input>!"
```

---

#### Chiamata a subroutine — `@N`

```
@N
```

Inserisce `(PC_corrente + 1)` nello stack di ritorno e salta alla riga N. L'esecuzione continua dalla riga N. Quando si incontra `*`, estrae l'indirizzo di ritorno e torna indietro.

- Le subroutine possono essere annidate fino alla profondità dello stack (4096 livelli di default).
- `@N` è **sempre** una chiamata (non un semplice salto) — l'indirizzo di ritorno viene sempre inserito nello stack.

```
1: @5          ← chiama la subroutine alla riga 5; inserisce 2 nello stack
2: >Tornato!
3: *           ← halt (lo stack è ora vuoto)
4: %
5: >Dentro la subroutine
6: *           ← ritorna alla riga 2
```

Output:
```
Dentro la subroutine
Tornato!
```

---

#### Output — `>`

```
>espressione
```

Valuta `espressione` (dopo aver risolto i riferimenti `#N`) e stampa il risultato seguito da un a capo. Il carattere `>` è il primo carattere della riga grezza — non è richiesto alcuno spazio tra `>` e l'espressione.

Se l'output è disabilitato (vedi `~`), l'espressione viene comunque valutata ma nulla viene stampato.

```
>Ciao, mondo!
>42
>1 + 1          ← stampa "2" (espressione numerica)
>#5             ← stampa il contenuto della riga 5
>Risultato: #10 ← stringa con riferimento incorporato
```

---

#### Salto condizionale — `?cond:@N`

```
?condizione:@N
```

Valuta `condizione` (dopo aver risolto i riferimenti `#N`). Se il risultato è **truthy**, salta alla riga N. Altrimenti avanza alla riga successiva.

**Truthy** significa:
- Un numero diverso da zero.
- Una stringa non vuota (quando la condizione non può essere valutata come espressione numerica).

La parte `:@N` deve apparire alla fine della riga. La condizione è tutto ciò che si trova tra `?` e l'ultimo `:@`.

```
#(10:0)
>Inizio
#(10:#10 + 1)
?#10 < 5:@3       ← torna alla riga 3 finché il contatore < 5
>Fine
```

---

#### Mutazione di riga — `#(N:expr)`

```
#(N:expr)
```

Valuta `expr` (dopo aver risolto i riferimenti `#N` al suo interno) e memorizza il risultato nella riga N, sostituendone completamente il contenuto. Questa è l'istruzione di assegnazione di MINKOWSKI ed è il meccanismo per il codice auto-modificante.

- N deve essere un intero positivo.
- Se N è oltre l'ultima riga corrente, il programma viene esteso con righe vuote fino a N.
- `expr` può contenere riferimenti `#M` che vengono risolti prima della valutazione.
- Il risultato è il valore valutato (numerico o stringa).

```
#(20:0)          ← riga 20 = "0"   (inizializzazione)
#(20:#20 + 1)    ← riga 20 = "1"   (incremento)
#(20:#20 + 1)    ← riga 20 = "2"
>#20             ← stampa "2"
```

Le variabili vengono tipicamente memorizzate in righe **non eseguite** dal PC (righe con numero alto, oltre il codice del programma), per evitare di sovrascrivere accidentalmente le istruzioni.

---

#### Riferimento a riga — `#N`

```
#N
```

`#N` all'interno di qualsiasi espressione, output, condizione o mutazione **si espande al contenuto corrente della riga N**, ricorsivamente. La profondità di risoluzione è limitata a 64 per prevenire loop infiniti.

Per includere un `#N` letterale nell'output senza espansione, si usa il backslash come escape: `\#N`.

```
>#5           ← si espande al contenuto della riga 5
>#5 + 1       ← espande la riga 5, poi aggiunge 1 (se numerica)
>Valore: \#5  ← stampa il letterale "Valore: #5"
```

I riferimenti possono essere concatenati: se la riga 5 contiene `#10`, e la riga 10 contiene `42`, allora `>#5` stampa `42`.

---

### Espressioni

Quando il valore risolto di una stringa è composto **interamente** da: cifre, spazi, `+`, `-`, `*`, `/`, `&`, `|`, `!`, `(`, `)`, `.`, `<`, `>`, `~`, `=` — viene trattato come **espressione numerica** e valutato aritmeticamente.

| MINKOWSKI | Significato |
|---|---|
| `+` `-` `*` `/` | Aritmetica |
| `&` o `&&` | AND logico |
| `\|` o `\|\|` | OR logico |
| `!` | NOT logico |
| `=` | Uguaglianza (`==`) |
| `~` | Disuguaglianza (`!=`) |
| `<` `>` `<=` `>=` | Confronto |
| `(` `)` | Raggruppamento |
| `.` | Punto decimale |

I risultati booleani (`true`/`false`) vengono restituiti come `1`/`0`.

Se la stringa contiene qualsiasi carattere fuori dall'insieme consentito, viene trattata come **stringa semplice** e restituita così com'è.

---

### Condizioni di halt

Il programma termina in uno di questi casi:

1. **PC fuori intervallo**: il contatore di programma avanza oltre l'ultima riga (o scende sotto la riga 1).
2. **`*` con stack vuoto**: `*` viene eseguito quando lo stack di ritorno è vuoto.
3. **Limite di guardia** (dipendente dall'implementazione): alcune implementazioni si fermano dopo 1 000 000 di passi per prevenire loop infiniti.

---

### Pattern e idiomi

#### Variabili

Memorizzare i valori in righe molto al di là del codice. Usare `#(N:valore)` per scrivere e `#N` per leggere.

```
#(100:0)    ← variabile alla riga 100
#(101:1)    ← altra variabile
#(100:#100 + #101)   ← somma e memorizza
```

#### Loop

```
#(50:0)              ← contatore = 0
>#50                 ← stampa il contatore  (riga 2)
#(50:#50 + 1)        ← contatore++
?#50 < 10:@2         ← se contatore < 10, torna alla riga 2
```

#### Salto incondizionato

Non esiste un `goto` semplice in MINKOWSKI. Si usa una condizione sempre vera:

```
?1:@N
```

#### Subroutine con nome

Mettere le subroutine alla fine del programma o in righe con numero alto. Chiamarle con `@N` e terminarle con `*`.

```
1: @20        ← chiama la subroutine "saluta"
2: >Fine.
3: *
…
20: >Ciao!    ← corpo della subroutine
21: *         ← ritorna
```

#### Salti calcolati

Poiché `@N` richiede un numero letterale, i salti calcolati non sono direttamente supportati. Soluzione: usare `#(N:@destinazione)` per riscrivere un'istruzione di salto, poi lasciare che il PC la raggiunga.

#### Sopprimere l'output durante il calcolo

```
~
#(50:#50 * #50)   ← calcola senza stampare
~
>#50              ← ora stampa il risultato
```

---

### Esempi completi

#### Ciao, mondo!

```
>Ciao, mondo!
```

---

#### Contatore (da 1 a 5)

```
#(10:1)
>Contatore: #10
#(10:#10 + 1)
?#10 <= 5:@2
>Fine.
```

Output:
```
Contatore: 1
Contatore: 2
Contatore: 3
Contatore: 4
Contatore: 5
Fine.
```

---

#### Sequenza di Fibonacci (primi 10 termini)

Le variabili si trovano alle righe 20-23, ben al di sopra delle 10 righe di codice.

```
>Fibonacci:
#(20:0)
#(21:1)
#(22:0)
>#20
#(23:#20 + #21)
#(20:#21)
#(21:#23)
#(22:#22 + 1)
?#22 < 10:@5
```

Output:
```
Fibonacci:
0
1
1
2
3
5
8
13
21
34
```

---

#### Input interattivo

```
>Come ti chiami?
                       ← riga vuota: legge input nella riga 2
>Ciao, #2!
```

---

#### Chiamata a subroutine

```
#(50:0)
>Prima della chiamata: #50
@7
>Dopo la chiamata: #50
*
%
#(50:#50 + 10)
>Subroutine eseguita. #50
*
```

---

### Compilatore C

Questo repository include `minkc`, un compilatore che traduce i sorgenti MINKOWSKI in programmi C autonomi.

#### Build

```bash
cd minkowski-compiler
make
```

Richiede GCC (o qualsiasi compilatore C11 compatibile) e `make`.

#### Utilizzo

```bash
./minkc programma.mink          # genera programma.c
./minkc programma.mink -o out.c # specifica il file di output
gcc -O2 out.c -o programma -lm
./programma
```

#### Come funziona

Poiché MINKOWSKI permette codice auto-modificante (`#(N:...)`), il compilatore non può eliminare completamente il runtime. Invece, `minkc` genera un file C autonomo che incorpora:

1. **La memoria iniziale** — tutte le righe sorgente come array di stringhe.
2. **Un runtime leggero** — risolutore di riferimenti, valutatore di espressioni a discesa ricorsiva, stack di chiamata e loop dell'interprete.

Il file C generato non ha dipendenze esterne oltre alla libreria standard C e `libm`. Viene compilato ed eseguito come qualsiasi altro programma C.

---

*MINKOWSKI — lines are memory, memory is code.*
