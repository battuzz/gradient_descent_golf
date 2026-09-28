# Gradient Descent Golf — Guida per il docente

Questa guida serve per preparare una lezione in cui il gioco *Gradient Descent Golf*
viene usato per introdurre l'ottimizzazione tramite discesa del gradiente
(Gradient Descent, GD) e le sue varianti stocastiche (SGD). Contiene:

1. l'idea del gioco e come si gioca;
2. la corrispondenza precisa tra elementi del gioco e concetti matematici;
3. la matematica "vera" che c'è sotto (funzione di loss, gradiente, rumore, punteggio);
4. una proposta di scaletta per la lezione, con domande da porre agli studenti.

Tutti i numeri citati (numero di tiri, livelli di rumore, ecc.) sono quelli
effettivamente usati nel codice (`src/game/landscape.ts`, `src/components/Game.tsx`,
`src/components/GameCanvas.tsx`).

---

## 1. L'idea in una frase

> **Lo studente è l'ottimizzatore.** Deve portare una pallina nel punto più basso
> di un terreno nascosto (la *funzione di loss*) usando un numero limitato di tiri.
> Ogni tiro è un passo di discesa del gradiente: la **direzione** la sceglie lo
> studente (aiutato da una freccia che indica il −gradiente), la **lunghezza** del
> tiro è il **learning rate**.

Il terreno è coperto dalla "nebbia": si vede solo ciò che si è già esplorato,
esattamente come un algoritmo di ottimizzazione conosce la funzione solo nei
punti in cui l'ha valutata.

---

## 2. Come si gioca (logistica in aula)

### Due schermi, una sessione condivisa ("evento")

- **Classifica** (pagina principale): va proiettata sul PC/TV dell'aula. Mostra
  la classifica live e un **QR code**.
- **Gioco**: gli studenti inquadrano il QR code col telefono e giocano.
  A fine partita il punteggio viene pubblicato e la classifica si aggiorna in
  pochi secondi.

Prima della lezione impostare il campo **Evento** nella pagina della classifica
con un nome univoco (es. `lezione-ml-2026-10`). Il nome dell'evento determina
anche il terreno: **tutti gli studenti che giocano lo stesso evento allo stesso
livello affrontano esattamente lo stesso percorso**, quindi i punteggi sono
confrontabili. Cambiando nome dell'evento si genera un percorso nuovo.

### Comandi

- **Tiro (fionda)**: si tocca la pallina e si trascina *all'indietro*; al rilascio
  la pallina parte nella direzione opposta. Più si trascina, più lungo è il passo
  (= learning rate più alto). Un trascinamento cortissimo annulla il tiro.
- **Guardarsi intorno**: trascinare altrove ruota la telecamera; pizzicare con due
  dita per lo zoom.
- **Freccia gialla pulsante**: indica la direzione del −gradiente (eventualmente
  rumoroso) nel punto in cui si trova la pallina.
- **Slider `w`** (solo livelli 4D): sceglie il valore del quarto parametro.
- **"Ho trovato il minimo — termina il turno"** (da toccare due volte per confermare): si può chiudere la partita prima di aver usato tutti i tiri
  (early stopping!).

Nell'HUD in alto si leggono: la loss attuale, la loss migliore raggiunta, la
norma del gradiente ‖∇L‖ e (nei livelli 4D) il valore corrente di `w`.

### I quattro livelli

| Livello           | Tiri | Dimensioni     | Valli "esca" | Rumore gradiente | Rumore atterraggio | Visibilità              | Moltiplicatore |
|-------------------|------|----------------|--------------|------------------|--------------------|-------------------------|----------------|
| **Batch GD**      | 8    | 2 parametri (3D) | 0          | 0 (esatto)       | 0                  | raggio 0.6, piena        | ×1             |
| **SGD**           | 7    | 2 parametri (3D) | 5          | 0.30             | 0.03               | raggio 0.21, a chiazze (50%) | ×1.25     |
| **Hyper-SGD 4D**  | 7    | 3 parametri (4D) | 7          | 0.45             | 0.05               | raggio 0.26, piena       | ×1.5           |
| **Hyper-SGD 4D ∞**| 7    | 3 parametri (4D) | 7          | 0.45             | 0.05               | raggio 0.26, piena       | ×2             |

"Hyper-SGD 4D ∞" è identico a "Hyper-SGD 4D" ma genera **una mappa nuova a ogni
partita**: non si può memorizzare dove sta il minimo giocando più volte. Per
questo vale di più.

---

## 3. Dizionario gioco ↔ matematica

| Nel gioco                                  | Concetto                                                                 |
|--------------------------------------------|--------------------------------------------------------------------------|
| Posizione della pallina (x, y) [e w]       | Vettore dei parametri θ del modello                                      |
| Altezza/colore del terreno                 | Funzione di loss L(θ)                                                    |
| Punto più chiaro/basso                     | Minimo globale θ* = argmin L(θ)                                          |
| Freccia gialla                             | −∇L(θ): direzione di massima discesa (stimata)                           |
| Lunghezza del trascinamento                | Learning rate η                                                          |
| Un tiro                                    | Un'iterazione di ottimizzazione θₖ₊₁ = θₖ + passo                       |
| Numero di tiri                             | Budget di iterazioni / epoche / tempo di calcolo                         |
| Valli "esca"                               | Minimi locali                                                            |
| Increspature del terreno                   | Non-convessità "fine", rugosità della loss                               |
| Freccia che "trema" (livello SGD)          | Gradiente stocastico da mini-batch: stima rumorosa ma non distorta       |
| Pallina che non atterra esattamente dove mirato | Rumore nell'aggiornamento (es. rumore numerico, dropout, ecc.)      |
| Nebbia                                     | L'ottimizzatore conosce la loss solo nei punti in cui l'ha valutata      |
| Slider `w` (quarta dimensione)             | Spazi ad alta dimensione: non si possono "vedere" tutti insieme          |
| Tasto "termina il turno"                         | Early stopping                                                           |
| Punteggio                                  | Frazione del divario iniziale (loss di partenza → minimo) colmata        |

---

## 4. La matematica sotto il cofano

### 4.1 Lo spazio dei parametri

I parametri vivono nel quadrato [−1, 1] × [−1, 1] (nei livelli 4D, nel cubo
[−1, 1]³ con la terza coordinata chiamata `w`). Se un tiro porterebbe la pallina
fuori, la posizione viene "tagliata" al bordo (clamping) — un esempio concreto di
**ottimizzazione vincolata / proiezione** sull'insieme ammissibile.

### 4.2 La funzione di loss

Il terreno è una somma di tre ingredienti. Con θ = (x, y, w):

```
L(θ) = 0.28·(x² + y²) + 0.18·w²                 ← "ciotola" quadratica (termine in w solo nel 4D)
       − Σᵢ dᵢ · exp( −‖(θ − cᵢ) / sᵢ‖² )       ← pozzi gaussiani (valli)
       + Σⱼ aⱼ · sin( kⱼ · θ + φⱼ )              ← 4 increspature sinusoidali
```

1. **Ciotola quadratica** — una funzione convessa di fondo, che spinge
   globalmente verso il centro. Da sola avrebbe un unico minimo in 0: è il caso
   "da manuale" in cui GD converge sempre.
2. **Pozzi gaussiani** — valli a forma di campana rovesciata:
   - un pozzo **principale** profondo (d = 1.1, larghezza s = 0.26) con centro
     casuale: è quello che crea il minimo globale;
   - alcuni pozzi **esca** meno profondi (d tra 0.4 e 0.8), più stretti e a volte
     ellittici (larghezze diverse lungo x e y), posti ad almeno 0.55 di distanza
     dal pozzo principale: sono i **minimi locali**.
   La larghezza sᵢ può essere diversa per ogni asse: valli allungate = problemi
   **mal condizionati**, dove il gradiente non punta dritto verso il fondo.
3. **Increspature** — quattro onde sinusoidali con direzione e frequenza casuali
   (frequenza tra 6 e 14). L'ampiezza dipende dal livello (0.03 in Batch GD,
   0.11 in SGD, 0.16 nei livelli 4D). Creano tanti piccoli minimi locali e rendono
   il gradiente "nervoso": è la rugosità tipica delle loss reali.

Messaggio didattico: sommando pochi ingredienti semplici si ottiene una funzione
**non convessa**, con molti minimi locali — proprio come le loss delle reti
neurali.

### 4.3 Il gradiente

Il gradiente è il vettore delle derivate parziali:

```
∇L(θ) = ( ∂L/∂x , ∂L/∂y , ∂L/∂w )
```

Indica la direzione in cui L **cresce** più rapidamente; quindi −∇L è la
direzione di **massima discesa**. La sua norma ‖∇L‖ (mostrata nell'HUD) dice
quanto è ripido il terreno: vicino a un minimo (o a un punto di sella, o su un
plateau) tende a zero.

Nel gioco il gradiente è calcolato con **differenze finite centrate**:

```
∂L/∂x ≈ ( L(x+h, y, w) − L(x−h, y, w) ) / (2h),     h = 0.001
```

Spunto: nelle reti neurali il gradiente si calcola invece in modo esatto con la
**backpropagation** (differenziazione automatica); le differenze finite sono
semplici ma costano 2 valutazioni della funzione per ogni parametro — improponibile
con milioni di parametri.

### 4.4 Il passo: discesa del gradiente

La regola classica della discesa del gradiente è

```
θₖ₊₁ = θₖ − η · ∇L(θₖ)
```

dove η è il learning rate. Nel gioco il passo è leggermente diverso:

```
θₖ₊₁ = θₖ + η · 0.8 · d        con  ‖d‖ = 1,   η ∈ (0, 1]
```

- **d** è la direzione scelta dallo studente (idealmente d ≈ −∇L/‖∇L‖, cioè la
  freccia gialla);
- **η** è dato dalla lunghezza del trascinamento (normalizzata rispetto alla
  diagonale dello schermo, e limitata a 1);
- 0.8 è la lunghezza massima di un tiro (un tiro a piena potenza attraversa il
  40% del campo).

Quindi la lunghezza del passo **non** dipende dalla ripidità del terreno: è una
discesa del gradiente **normalizzata** (solo la direzione del gradiente conta).
Questo è un ottimo spunto di discussione:

- nella GD "pura" il passo è η·‖∇L‖: grande dove il terreno è ripido, piccolo
  vicino al minimo → rallenta da sola in prossimità del fondo;
- nel gioco lo studente deve fare lui questo lavoro: **ridurre il learning rate
  man mano che si avvicina al minimo** (learning rate schedule / decay);
- se il learning rate è troppo alto si "scavalca" la valle e si rimbalza
  (overshooting, oscillazioni, divergenza); se è troppo basso si sprecano tiri e
  non si arriva in fondo entro il budget.

### 4.5 La stocasticità: dal Batch GD allo SGD

**Batch GD.** Il gradiente mostrato dalla freccia è esatto: è quello calcolato
sull'intero dataset. È la situazione ideale (ma costosa nel mondo reale).

**SGD / mini-batch.** Nei livelli successivi la freccia mostra un gradiente
rumoroso:

```
g̃ = ∇L(θ) + σ · (0.7·‖∇L‖ + 0.15) · ε,     ε ~ N(0, I)
```

con σ = 0.30 (SGD) o 0.45 (4D). Osservazioni:

- il rumore ha **media zero**: in media la freccia punta nella direzione
  giusta (la stima è *non distorta*, come il gradiente di un mini-batch);
- l'ampiezza del rumore è in parte **proporzionale a ‖∇L‖** e in parte
  costante (0.15): anche dove il terreno è piatto la freccia continua a
  "tremare" — vicino al minimo il rapporto segnale/rumore peggiora, proprio come
  in SGD, dove il gradiente vero tende a zero ma la varianza del mini-batch no;
- il rumore è deterministico per percorso e numero di tiro: tutti gli studenti,
  nello stesso punto dello stesso turno, vedono lo stesso "mini-batch" (serve
  per l'equità della classifica).

In più, nei livelli rumorosi anche l'**atterraggio** è perturbato: alla
posizione finale si somma un rumore gaussiano con deviazione standard 0.03 (SGD)
o 0.05 (4D). Il passo effettivo non è mai esattamente quello voluto.

Messaggi da far emergere:

- lo SGD non segue una traiettoria pulita, ma "zigzaga" attorno a quella del
  batch GD;
- il rumore è un **difetto** (serve un learning rate più piccolo per stabilizzarsi
  vicino al minimo) ma anche un **pregio**: può aiutare a uscire da minimi
  locali poco profondi e a esplorare.

### 4.6 Minimi locali e non-convessità

Con i pozzi esca la loss ha più minimi. Seguire ciecamente la freccia da un
punto di partenza sfortunato porta nella valle più vicina, che spesso **non** è
quella globale. Il punto di partenza è scelto apposta "sfavorevole": ad almeno
1.1 di distanza dal minimo globale e con loss sopra la mediana.

Spunti:
- l'**inizializzazione** conta;
- a volte conviene "sprecare" un tiro lungo per esplorare (trade-off
  **esplorazione / sfruttamento**);
- tecniche come momentum, restart multipli, rumore, learning rate alti
  all'inizio servono proprio a non restare intrappolati.

### 4.7 La nebbia: informazione locale

Il terreno si vede solo entro un certo raggio attorno ai punti già visitati
(e a punti intermedi lungo ciascun tiro). Nel livello SGD la zona rivelata è
anche "a chiazze" (solo il 50% dei pixel): una stima parziale e rumorosa.

È la metafora chiave della lezione: **un algoritmo di ottimizzazione non vede
il paesaggio**. Conosce solo il valore della loss e il gradiente nei punti in
cui li ha calcolati. La mappa completa che noi disegniamo alla lavagna per
spiegare GD è un lusso che l'algoritmo non ha.

A fine partita la nebbia si alza e si vede tutto il terreno, con il percorso
seguito: ottimo momento per commentare le scelte fatte.

### 4.8 La quarta dimensione

Nei livelli 4D la loss dipende da tre parametri (x, y, w); con l'altezza del
terreno fanno 4 dimensioni. Lo schermo mostra solo la **fetta** del terreno a
`w` fissato; per muoversi lungo `w` si usa lo slider (al massimo di 0.5 per tiro
secondo il suggerimento del gradiente, indicato dal segno giallo sullo slider;
il segno bianco è il valore attuale; il pulsante "usa ∇" imposta lo slider sul
valore suggerito). Muovendo lo slider prima di tirare si vede
in anteprima come cambia la fetta.

Messaggi:
- nei problemi reali i parametri sono milioni: **non possiamo visualizzare** la
  loss, possiamo solo guardarne sezioni o proiezioni;
- un punto che sembra un minimo in una fetta 2D può non esserlo nello spazio
  completo (e viceversa): è l'idea dei **punti di sella**;
- aggiornare i parametri "a coordinate", uno alla volta (prima `w` con lo
  slider, poi x/y col tiro), richiama la **discesa per coordinate**.

Dopo la partita si può esplorare la mappa rivelata fetta per fetta, con i
pulsanti "la tua w" e "w obiettivo".

### 4.9 Il punteggio

Siano L₀ la loss nel punto di partenza, L_best la loss **migliore** raggiunta
durante la partita e L* il minimo globale (trovato dal gioco con una ricerca su
griglia fine). Il progresso normalizzato è

```
t = (L₀ − L_best) / (L₀ − L*)          (troncato in [0, 1])
```

e i punti sono

```
punti = round( 1000 · t^1.5 · moltiplicatore )
```

- t = 0: non si è migliorato nulla; t = 1: si è raggiunto il minimo globale.
- L'esponente 1.5 rende la funzione **convessa**: gli ultimi miglioramenti
  valgono più dei primi (arrivare al 50% del divario vale ~354 punti, al 90% ~854).
  Scendere velocemente è facile, rifinire vicino al minimo è difficile — come
  nell'addestramento reale.
- Conta la loss **migliore** raggiunta, non l'ultima: è come salvare il
  **checkpoint migliore** durante il training. Un ultimo tiro azzardato non
  fa perdere punti.
- La normalizzazione rispetto al punto di partenza rende confrontabili percorsi
  diversi.

Il minimo globale L* è calcolato per forza bruta: griglia 56×56 (×21 in `w`) e
poi quattro raffinamenti locali con griglie via via più fitte. Spunto: questo
funziona in 2-3 dimensioni, ma una griglia in d dimensioni ha 56ᵈ punti —
**maledizione della dimensionalità** — ed è il motivo per cui usiamo il
gradiente.

---

## 5. Proposta di scaletta (≈ 60–90 minuti)

**0. Preparazione (prima della lezione)**
- Aprire la pagina della classifica sul proiettore, impostare un nome evento.
- Provare una partita per livello per familiarizzare con i comandi.

**1. Aggancio (5 min)**
- "Siete bendati su una collina e dovete arrivare a valle. Potete solo sentire
  la pendenza sotto i piedi. Come fate?" → idea intuitiva di gradiente.

**2. Primo round: Batch GD (10 min)**
- Tutti giocano 1–2 partite a Batch GD.
- Domande:
  - Che cosa indica la freccia? (−gradiente)
  - Che cosa succede se tirate troppo forte? E troppo piano?
  - Avete cambiato la forza del tiro man mano che vi avvicinavate al minimo? Perché?
- Formalizzare alla lavagna: θₖ₊₁ = θₖ − η ∇L(θₖ); ruolo di η.

**3. Teoria: gradiente e learning rate (15 min)**
- Derivate parziali, gradiente come direzione di massima pendenza.
- Esempio 1D alla lavagna: L(θ) = θ², passo θₖ₊₁ = (1 − 2η)θₖ.
  - η < 0.5: convergenza monotona;
  - 0.5 < η < 1: convergenza oscillante;
  - η = 1: oscillazione perpetua (θ → −θ → θ …);
  - η > 1: divergenza.
- Confronto con il gioco (passo normalizzato → serve un decay manuale).

**4. Secondo round: SGD (10 min)**
- Tutti giocano a SGD. Far notare: freccia che cambia, atterraggi imprecisi,
  valli esca, nebbia a chiazze.
- Domande:
  - Vi fidavate della freccia? Quando meno? (vicino al minimo)
  - Qualcuno è finito in una valle sbagliata? Come ve ne siete accorti?
    Come ne siete usciti?
  - Vi è capitato di fermarvi prima (early stopping)? Perché?

**5. Teoria: SGD e non-convessità (15 min)**
- Loss come media sui dati: L(θ) = (1/N) Σ ℓᵢ(θ); gradiente di un mini-batch
  come stima non distorta ma rumorosa.
- Perché si usa comunque: costo per iterazione, rumore come regolarizzazione /
  esplorazione.
- Minimi locali, punti di sella, importanza dell'inizializzazione.
- Cenni: momentum, Adam, learning rate schedule.

**6. Terzo round: Hyper-SGD 4D / 4D ∞ (10 min)**
- La sfida finale, con classifica.
- Domande:
  - Come avete deciso come muovere `w`?
  - Che cosa vuol dire che "non si vede" la loss in alta dimensione?
  - Perché il livello ∞ vale di più? (non si può memorizzare: è
    generalizzazione vs memorizzazione!)

**7. Chiusura (5–10 min)**
- Premiazione dalla classifica.
- Riprendere la tabella "gioco ↔ matematica" (sezione 3).
- Takeaway:
  1. l'ottimizzazione vede solo informazioni locali (gradiente);
  2. il learning rate è il parametro più delicato e va adattato;
  3. il gradiente stocastico è rumoroso ma economico e utile;
  4. le loss reali sono non convesse e ad alta dimensione: il minimo globale non
     è garantito.

---

## 6. Domande di verifica / approfondimento

1. Perché −∇L è la direzione di massima discesa? (Suggerimento: derivata
   direzionale ∇L·u, minimizzata su ‖u‖ = 1 da u = −∇L/‖∇L‖, per Cauchy-Schwarz.)
2. Nel gioco la lunghezza del passo non dipende da ‖∇L‖. Che vantaggi e
   svantaggi ha rispetto alla GD classica?
3. Con L(θ) = aθ², per quali valori di η la GD converge? (0 < η < 1/a)
4. Perché il rumore del livello SGD non scompare vicino al minimo? Che
   strategia adottereste per convergere comunque? (ridurre η)
5. Il punteggio usa la loss migliore e non quella finale. A quale pratica
   dell'addestramento corrisponde? (checkpoint del modello migliore / early stopping)
6. Quanti punti servirebbero per trovare il minimo con una griglia di 56 valori
   per asse in 10 dimensioni? E in 1 milione? (56¹⁰ ≈ 3·10¹⁷)
7. Perché il livello "∞" usa una mappa nuova ogni volta? Che cosa c'entra con
   la differenza tra memorizzare e generalizzare?

---

## 7. Nota tecnica sulla generazione dei percorsi

Il terreno è generato da un generatore di numeri pseudo-casuali inizializzato
con un seed ricavato (tramite hash FNV-1a) dalla stringa `evento:livello`.
Stesso seed → stessa sequenza di numeri → stesso terreno, stesso punto di
partenza, stesso rumore sui gradienti e sugli atterraggi a parità di posizione
nella sequenza di tiri. Il rumore gaussiano è ottenuto con la trasformazione di
Box-Muller:

```
ε = √(−2 ln u) · cos(2π v),     u, v ~ Uniforme(0, 1)
```

È un bell'esempio collaterale di come in informatica la "casualità" sia spesso
deterministica e riproducibile — lo stesso principio per cui negli esperimenti
di machine learning si fissa il seed.
