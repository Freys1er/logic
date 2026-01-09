export function getDefaultTemplate() {
    return `// ==========================================
// Template: Infinite Trivia Blitz
// ==========================================

// @description Generate a list of trivia questions. Format per line: Question | Option A | Option B | Option C | Correct Letter (A, B, or C). Do not number the lines.
// @label Question Data @type textarea
let scriptText = "Which planet is the hottest? | Mars | Venus | Mercury | B\\nWhat is the chemical symbol for Gold? | Au | Ag | Fe | A\\nWho painted the Mona Lisa? | Van Gogh | Da Vinci | Picasso | B\\nHow many bones in the human body? | 206 | 208 | 210 | A";

// @label Timer Seconds (Per Question) @type number
let timerSeconds = 5;

// @label Theme Color @type color
let themeColor = "#00CEC9";

// @label Background Color @type color
let bgColor = "#2D3436";

// --- NEW ---
// @label Show Debug Overlay @type text
// @description Set to "true" to show timing and state variables on screen.
let showDebug = "true";


// --- INTERNAL STATE ---
let videoAsset = null;
let parsedQuestions = [];
let lastScriptHash = "";
let totalFrames = 300;
let framesPerQuestion = 0;
let fps = 30; // Assumed standard

// TTS & Debug State
let spokenQuestions = new Set();
let spokenAnswers = new Set();

function setup() {
    createCanvas(1080, 1920);
    textAlign(CENTER, CENTER);
    rectMode(CENTER);

    // Load Optional BG Video
    let vidName = os.files.list().find(f => f.match(/\\.(mp4|mov|webm)$/i));
    if (vidName) videoAsset = os.files.get(vidName);
    
    parseGameLogic();
}

function render(t, frame) {
    if (scriptText !== lastScriptHash) {
        parseGameLogic();
    }
    
    // Reset TTS on loop
    if (frame < 2) {
        spokenQuestions.clear();
        spokenAnswers.clear();
    }

    // 1. Calculate which question we are on
    let floatIndex = t * parsedQuestions.length;
    let currentIndex = Math.floor(floatIndex);
    if (currentIndex >= parsedQuestions.length) currentIndex = parsedQuestions.length - 1;
    let currentQ = parsedQuestions[currentIndex];

    // 2. Calculate "Local Time" for this specific question
    let localT = floatIndex % 1; 
    let localFrame = localT * framesPerQuestion;
    
    // Define phase timings
    let revealFrame = (1.5 + timerSeconds) * fps;
    let isRevealed = localFrame >= revealFrame;

    // --- DRAWING ---
    background(bgColor);
    if (videoAsset) {
        let s = Math.max(width/videoAsset.width, height/videoAsset.height);
        imageMode(CENTER);
        image(videoAsset, width/2, height/2, videoAsset.width*s, videoAsset.height*s);
        fill(0, 200); noStroke(); rect(width/2, height/2, width, height);
    }

    let totalProgress = width * t;
    fill(themeColor); noStroke();
    rectMode(CORNER); rect(0, 0, totalProgress, 15); rectMode(CENTER);

    // --- NEW: TTS LOGIC (Question) ---
    if (currentQ && !spokenQuestions.has(currentIndex)) {
        if (os.sound.speak(currentQ.question)) {
            spokenQuestions.add(currentIndex);
        }
    }

    // Render current question card
    if (currentQ) {
        renderCard(currentQ, localFrame, revealFrame, currentIndex);
    }

    // --- NEW: DEBUG OVERLAY ---
    if (String(showDebug).toLowerCase() === "true") {
        renderDebug(t, localT, currentIndex, isRevealed);
    }
}

function renderCard(q, cf, revealFrame, qIndex) {
    let isRevealed = cf >= revealFrame;
    let qNum = qIndex + 1;

    fill(255); textSize(55); textStyle(BOLD);
    textLeading(65);
    text(\`Q\${qNum}: \${q.question}\`, width/2, 400, 900);

    if (!isRevealed) {
        let timeLeft = map(cf, 45, revealFrame, 1, 0, true);
        noFill(); stroke(255, 50); strokeWeight(15);
        circle(width/2, 650, 120);
        stroke(themeColor);
        let angle = map(timeLeft, 1, 0, -HALF_PI, TWO_PI - HALF_PI);
        if (timeLeft > 0) arc(width/2, 650, 120, 120, -HALF_PI, angle);
        noStroke(); fill(255); textSize(45);
        text(Math.ceil(timerSeconds * timeLeft), width/2, 652);
    } else {
        noStroke(); fill(themeColor); textSize(45); textStyle(BOLD);
        text("ANSWER", width/2, 652);
        
        // --- NEW: TTS LOGIC (Answer) ---
        if (!spokenAnswers.has(qIndex)) {
            const answerText = \`The answer is \${q.correctText}\`;
            if (os.sound.speak(answerText)) {
                spokenAnswers.add(qIndex);
            }
        }
    }

    let startY = 850;
    let gap = 220;
    drawOption(q.options[0], "A", startY, cf, revealFrame, q.correct);
    drawOption(q.options[1], "B", startY + gap, cf, revealFrame, q.correct);
    drawOption(q.options[2], "C", startY + gap*2, cf, revealFrame, q.correct);
}

function drawOption(txt, letter, y, cf, revealFrame, correctLetter) {
    let isRevealed = cf >= revealFrame;
    let isCorrect = letter === correctLetter;
    
    let boxColor = color(255);
    let txtColor = color(0);
    let scaleVal = 1;

    if (isRevealed) {
        if (isCorrect) {
            boxColor = color(themeColor);
            txtColor = color(255);
            scaleVal = 1.05;
        } else {
            boxColor = color(80);
            txtColor = color(150);
            scaleVal = 0.95;
        }
    }

    push();
    translate(width/2, y);
    scale(scaleVal);
    fill(boxColor); noStroke();
    rect(0, 0, 850, 160, 25);
    fill(0, 30); circle(-350, 0, 80);
    fill(txtColor); textSize(40); textStyle(BOLD);
    text(letter, -350, 0);
    textSize(45); textAlign(LEFT, CENTER);
    text(txt, -280, 0, 550); // Added max width
    pop();
}

function parseGameLogic() {
    lastScriptHash = scriptText;
    parsedQuestions = [];
    spokenQuestions.clear();
    spokenAnswers.clear();

    let lines = scriptText.split('\\n').filter(l => l.includes('|'));
    lines.forEach(line => {
        let parts = line.split('|');
        if (parts.length >= 5) {
            const correctLetter = parts[4].trim().toUpperCase();
            let correctText = "";
            if(correctLetter === 'A') correctText = parts[1].trim();
            if(correctLetter === 'B') correctText = parts[2].trim();
            if(correctLetter === 'C') correctText = parts[3].trim();

            parsedQuestions.push({
                question: parts[0].trim(),
                options: [parts[1].trim(), parts[2].trim(), parts[3].trim()],
                correct: correctLetter,
                correctText: correctText,
            });
        }
    });

    let secondsPerQ = 1.5 + timerSeconds + 2.0; 
    framesPerQuestion = secondsPerQ * fps;
    totalFrames = framesPerQuestion * parsedQuestions.length;
    duration(totalFrames);
}

// --- NEW: DEBUG FUNCTION ---
function renderDebug(t, localT, qIndex, isRevealed) {
    push();
    rectMode(CORNER);
    textAlign(LEFT, TOP);
    textFont('monospace');
    
    let debugText = \`--- DEBUG ---
Global T: \${t.toFixed(3)}
Local T:  \${localT.toFixed(3)}
Q Index:  \${qIndex}
Revealed: \${isRevealed}\`;

    textSize(24);
    fill(0, 150);
    noStroke();
    rect(10, 25, 350, 150, 10);
    
    fill(255);
    text(debugText, 25, 40);
    pop();
}
`;
}