import express from 'express';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import MongoStore from 'connect-mongodb-session';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI is not defined in environment variables');
    process.exit(1);
}

const client = new MongoClient(MONGODB_URI);
let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db('healthcare_app');
        await db.collection('users').createIndex({ email: 1 }, { unique: true });
        await db.collection('activities').createIndex({ user_id: 1, tanggal: -1 });
        await db.collection('health_history').createIndex({ user_id: 1, tanggal: -1 });
        console.log('✅ MongoDB connected successfully');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
}

const EMAIL_CONFIG = {
    user: 'careurhealth.support@gmail.com',
    pass: 'usqbsngmafwbxlvr'
};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_CONFIG.user, pass: EMAIL_CONFIG.pass }
});

transporter.verify((error, success) => {
    if (error) console.error('❌ Email SMTP Error:', error.message);
    else console.log('✅ Email SMTP siap mengirim!');
});

const DEVELOPER_EMAIL = 'careurhealth.support@gmail.com';

const PAKASIR_CONFIG = {
    slug: 'web-health',
    apiKey: 'rtxJ8zS1CYHNc8JVwPOBFuiQQWc5x2mP',
    baseUrl: 'https://app.pakasir.com'
};

const AI_API_URL = 'https://api.siputzx.my.id/api/ai/gemini';

function generateRandomCookie() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let cookie = '';
    for (let i = 0; i < 16; i++) {
        cookie += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return cookie;
}

function detectLanguage(text) {
    const indonesianPatterns = /(aku|saya|kamu|dia|mereka|dan|atau|tapi|karena|jadi|kalau|jika|bagaimana|kenapa|apa|siapa|dimana|kapan|bisa|ingin|mau|tolong|coba|sudah|belum|sedang|akan|telah|lagi|sih|dong|kok|yah|nih|sana|sini|kesana|kesini|disana|disini|dari|ke|di|pada|untuk|dengan|tanpa|oleh|kepada|sejak|sampai|selama|ketika|saat|setelah|sebelum|karena|sebab|sehingga|maka|agar|supaya|walaupun|meskipun|biarpun|seandainya|apabila|bahwa|yang|ini|itu|tersebut|begitu|demikian)/i;
    
    let indoScore = 0;
    if (indonesianPatterns.test(text)) indoScore += 2;
    
    const indonesianWords = ['nya', 'kan', 'lah', 'pun', 'kah', 'per', 'ber', 'ter', 'me', 'di', 'ke', 'se'];
    indonesianWords.forEach(word => {
        if (text.toLowerCase().includes(word)) indoScore += 0.5;
    });
    
    return indoScore >= 1.5 ? 'id' : 'id';
}

async function callAIApi(question, language = 'id') {
    let finalPrompt;
    if (language === 'en') {
        finalPrompt = `You are a professional health assistant named HealthCare+ AI. 
IMPORTANT: You MUST answer in ENGLISH language only, regardless of what language the user uses.
Answer questions about health, exercise, nutrition, and healthy lifestyle in clear, easy-to-understand English.
Provide safe advice based on health science.
Always recommend consulting a doctor for serious medical issues.
Answer briefly, clearly, and informatively.`;
    } else {
        finalPrompt = `Kamu adalah asisten kesehatan profesional bernama HealthCare+ AI.
PENTING: Kamu WAJIB menjawab dalam BAHASA INDONESIA saja, apapun bahasa yang digunakan pengguna.
Jawab pertanyaan tentang kesehatan, olahraga, nutrisi, dan gaya hidup sehat dengan bahasa Indonesia yang mudah dipahami.
Berikan saran yang aman dan berbasis ilmu kesehatan.
Selalu sarankan konsultasi ke dokter untuk masalah medis serius.
Jawab dengan singkat, jelas, dan informatif.`;
    }
    
    const randomCookie = generateRandomCookie();
    const url = `${AI_API_URL}?text=${encodeURIComponent(question)}&cookie=${randomCookie}&promptSystem=${encodeURIComponent(finalPrompt)}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.status && data.data && data.data.response) {
            let responseText = data.data.response;
            if (language === 'id') {
                responseText = responseText.replace(/^Hello! I am HealthCare\+ AI.*?\.\s*/i, '');
                responseText = responseText.replace(/^I am your professional health assistant.*?\.\s*/i, '');
                responseText = responseText.trim();
                if (!responseText) responseText = data.data.response;
            }
            return { success: true, response: responseText };
        } else {
            return { success: false, error: 'Gagal mendapatkan respons dari AI' };
        }
    } catch (error) {
        console.error('AI API Error:', error);
        return { success: false, error: error.message };
    }
}

function getBMICategory(bmi) {
    if (bmi < 18.5) return 'underweight';
    if (bmi < 25) return 'normal';
    if (bmi < 30) return 'overweight';
    return 'obese';
}

function getLocalizedHealthStatus(category, language) {
    const statusMap = {
        id: { underweight: 'Kurus', normal: 'Normal', overweight: 'Gemuk Ringan', obese: 'Obesitas' },
        en: { underweight: 'Underweight', normal: 'Normal', overweight: 'Overweight', obese: 'Obese' }
    };
    return statusMap[language]?.[category] || statusMap.id[category];
}

function getLocalizedRiskMessage(category, language) {
    const riskMap = {
        id: {
            underweight: '⚠️ Risiko kekurangan gizi, osteoporosis, anemia',
            normal: '✅ Risiko penyakit minimal',
            overweight: '⚠️ Risiko penyakit jantung, diabetes tipe 2 meningkat',
            obese: '🚨 Risiko tinggi: penyakit jantung, stroke, diabetes'
        },
        en: {
            underweight: '⚠️ Risk of malnutrition, osteoporosis, anemia',
            normal: '✅ Minimal disease risk',
            overweight: '⚠️ Risk of heart disease, type 2 diabetes increases',
            obese: '🚨 High risk: heart disease, stroke, diabetes'
        }
    };
    return riskMap[language]?.[category] || riskMap.id[category];
}

function getLocalizedExerciseRecommendation(category, language) {
    const exerciseMap = {
        id: {
            underweight: { olahraga: '🏋️ Angkat beban ringan, Yoga, Pilates', frekuensi: '3-4x/minggu', tips: 'Fokus membangun massa otot.', benefit: 'Meningkatkan massa otot dan kepadatan tulang' },
            normal: { olahraga: '🏃 Lari, Renang, Bersepeda, Fitness', frekuensi: '3-5x/minggu (150-300 menit/minggu)', tips: 'Kombinasi cardio dan strength.', benefit: 'WHO merekomendasikan 150-300 menit olahraga/minggu' },
            overweight: { olahraga: '🏃 Jogging 30 menit, Bersepeda, HIIT pemula', frekuensi: '4-5x/minggu (200-300 menit/minggu)', tips: 'Target penurunan 0.5-1kg/minggu.', benefit: 'Penurunan berat badan 5-10% menurunkan risiko penyakit kronis 30%' },
            obese: { olahraga: '🚶 Jalan cepat 30 menit, Renang, Yoga ringan', frekuensi: '5-6x/minggu', tips: 'Mulai perlahan, konsultasi ke dokter.', benefit: 'Setiap 1kg penurunan berat badan mengurangi tekanan darah 1mmHg' }
        },
        en: {
            underweight: { olahraga: '🏋️ Light weight training, Yoga, Pilates', frekuensi: '3-4x/week', tips: 'Focus on building muscle mass.', benefit: 'Increases muscle mass and bone density' },
            normal: { olahraga: '🏃 Running, Swimming, Cycling, Fitness', frekuensi: '3-5x/week (150-300 minutes/week)', tips: 'Combine cardio and strength.', benefit: 'WHO recommends 150-300 minutes of exercise/week' },
            overweight: { olahraga: '🏃 Jogging 30 min, Cycling, Beginner HIIT', frekuensi: '4-5x/week (200-300 minutes/week)', tips: 'Target weight loss 0.5-1kg/week.', benefit: '5-10% weight loss reduces chronic disease risk by 30%' },
            obese: { olahraga: '🚶 Brisk walking 30 min, Swimming, Light Yoga', frekuensi: '5-6x/week', tips: 'Start slowly, consult your doctor.', benefit: 'Every 1kg weight loss reduces blood pressure by 1mmHg' }
        }
    };
    return exerciseMap[language]?.[category] || exerciseMap.id[category];
}

function getLocalizedNutritionRecommendation(category, language) {
    const nutritionMap = {
        id: {
            underweight: { sarapan: '🥣 Oatmeal + susu + telur + pisang', makanSiang: '🍚 Nasi + daging/ikan + sayur', makanMalam: '🐟 Ikan + kentang + sayur hijau', camilan: '🥜 Kacang-kacangan, yogurt', tips: 'Tambah porsi makan, protein 1.2-1.5g/kgBB' },
            normal: { sarapan: '🥣 Sereal gandum + susu + buah', makanSiang: '🍛 Nasi merah + lauk seimbang + sayur', makanMalam: '🥗 Salad + protein + quinoa', camilan: '🍎 Buah segar, kacang', tips: 'Pertahankan pola makan seimbang, kurangi gula' },
            overweight: { sarapan: '🍳 Telur rebus + roti gandum + alpukat', makanSiang: '🍚 Nasi merah + ayam panggang + sayur', makanMalam: '🥑 Salad sayur + ikan bakar', camilan: '🥒 Wortel, yogurt rendah lemak', tips: 'Defisit kalori 500kkal/hari, perbanyak serat' },
            obese: { sarapan: '🥣 Oatmeal + buah beri + kacang almond', makanSiang: '🥗 Sayuran hijau + ikan salmon + quinoa', makanMalam: '🥦 Sup sayur + tahu/tempe', camilan: '🥒 Sayuran segar, air putih', tips: 'Konsultasi ke dokter spesialis gizi' }
        },
        en: {
            underweight: { sarapan: '🥣 Oatmeal + milk + egg + banana', makanSiang: '🍚 Rice + meat/fish + vegetables', makanMalam: '🐟 Fish + potato + green vegetables', camilan: '🥜 Nuts, yogurt', tips: 'Increase meal portions, protein 1.2-1.5g/kg body weight' },
            normal: { sarapan: '🥣 Whole grain cereal + milk + fruit', makanSiang: '🍛 Brown rice + balanced side dish + vegetables', makanMalam: '🥗 Salad + protein + quinoa', camilan: '🍎 Fresh fruit, nuts', tips: 'Maintain balanced diet, reduce sugar' },
            overweight: { sarapan: '🍳 Boiled egg + whole wheat bread + avocado', makanSiang: '🍚 Brown rice + grilled chicken + vegetables', makanMalam: '🥑 Vegetable salad + grilled fish', camilan: '🥒 Carrots, low-fat yogurt', tips: '500kcal/day calorie deficit, increase fiber' },
            obese: { sarapan: '🥣 Oatmeal + berries + almonds', makanSiang: '🥗 Green vegetables + salmon + quinoa', makanMalam: '🥦 Vegetable soup + tofu/tempeh', camilan: '🥒 Fresh vegetables, water', tips: 'Consult a nutrition specialist' }
        }
    };
    return nutritionMap[language]?.[category] || nutritionMap.id[category];
}

function getLocalizedPremiumExercise(category, language) {
    const premiumMap = {
        id: {
            underweight: { olahraga: '🏋️ Strength Training (3x/minggu), Yoga (2x/minggu), Pilates (1x/minggu)', detail: 'Fokus pada latihan resistance untuk membangun massa otot. Mulai dengan beban ringan 5-10kg.', tips: 'Konsumsi protein 30 menit setelah latihan untuk optimalisasi pemulihan otot.' },
            normal: { olahraga: '🏃 HIIT (2x/minggu), Lari jarak jauh (2x/minggu), Renang (1x/minggu), Yoga (1x/minggu)', detail: 'Variasi latihan cardio dan strength untuk menjaga kebugaran optimal.', tips: 'Periodisasi latihan: 4 minggu fokus endurance, 2 minggu fokus strength.' },
            overweight: { olahraga: '🔥 HIIT pemula (3x/minggu), Jogging (2x/minggu), Bersepeda (2x/minggu)', detail: 'Kombinasi HIIT dan LISS untuk pembakaran lemak maksimal. HIIT 20 menit, LISS 40 menit.', tips: 'Defisit kalori 500kkal/hari + olahraga teratur = turun 0.5-1kg/minggu.' },
            obese: { olahraga: '🚶 Jalan cepat (5x/minggu), Renang (3x/minggu), Yoga pemula (2x/minggu)', detail: 'Mulai dengan low-impact exercise untuk melindungi sendi. Tingkatkan intensitas bertahap.', tips: 'Konsultasi ke dokter sebelum memulai program olahraga intensitas tinggi.' }
        },
        en: {
            underweight: { olahraga: '🏋️ Strength Training (3x/week), Yoga (2x/week), Pilates (1x/week)', detail: 'Focus on resistance training to build muscle mass. Start with light weights 5-10kg.', tips: 'Consume protein 30 minutes after workout for optimal muscle recovery.' },
            normal: { olahraga: '🏃 HIIT (2x/week), Long distance running (2x/week), Swimming (1x/week), Yoga (1x/week)', detail: 'Variety of cardio and strength training to maintain optimal fitness.', tips: 'Exercise periodization: 4 weeks endurance focus, 2 weeks strength focus.' },
            overweight: { olahraga: '🔥 Beginner HIIT (3x/week), Jogging (2x/week), Cycling (2x/week)', detail: 'Combine HIIT and LISS for maximum fat burning. HIIT 20 min, LISS 40 min.', tips: '500kcal/day calorie deficit + regular exercise = lose 0.5-1kg/week.' },
            obese: { olahraga: '🚶 Brisk walking (5x/week), Swimming (3x/week), Beginner Yoga (2x/week)', detail: 'Start with low-impact exercise to protect joints. Increase intensity gradually.', tips: 'Consult a doctor before starting high-intensity exercise program.' }
        }
    };
    return premiumMap[language]?.[category] || premiumMap.id[category];
}

const premiumHealthTips = {
    id: [
        '💧 Minum air putih 2-3 liter per hari membantu metabolisme hingga 30%',
        '😴 Tidur 7-8 jam per malam menurunkan risiko obesitas hingga 41%',
        '🍎 Makan apel sebelum makan utama dapat mengurangi asupan kalori hingga 15%',
        '🧘 Meditasi 10 menit/hari menurunkan hormon stres kortisol',
        '🏃 Jalan kaki 10 menit setelah makan membantu mengontrol gula darah',
        '🥗 Makan teratur 3 kali sehari lebih baik daripada 1-2 kali makan besar',
        '📱 Kurangi screen time 1 jam sebelum tidur untuk kualitas tidur lebih baik',
        '🌿 Teh hijau mengandung antioksidan yang membantu pembakaran lemak',
        '💪 Latihan kekuatan 2x/minggu mempertahankan massa otot saat diet',
        '🧠 Belajar hal baru setiap hari menjaga kesehatan kognitif'
    ],
    en: [
        '💧 Drinking 2-3 liters of water per day boosts metabolism by up to 30%',
        '😴 Sleeping 7-8 hours per night reduces obesity risk by up to 41%',
        '🍎 Eating an apple before main meal can reduce calorie intake by 15%',
        '🧘 10 minutes of meditation per day reduces cortisol stress hormone',
        '🏃 10-minute walk after meals helps control blood sugar',
        '🥗 Eating regularly 3 times a day is better than 1-2 large meals',
        '📱 Reduce screen time 1 hour before bed for better sleep quality',
        '🌿 Green tea contains antioxidants that help burn fat',
        '💪 Strength training 2x/week maintains muscle mass during diet',
        '🧠 Learning something new every day maintains cognitive health'
    ]
};

async function createPakasirTransaction(orderId, amount, customerName, customerEmail) {
    try {
        const response = await fetch(`${PAKASIR_CONFIG.baseUrl}/api/transactioncreate/qris`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project: PAKASIR_CONFIG.slug,
                order_id: orderId,
                amount: amount,
                api_key: PAKASIR_CONFIG.apiKey,
                customer_name: customerName,
                customer_email: customerEmail
            })
        });
        const data = await response.json();
        if (data.payment && data.payment.payment_number) {
            return {
                success: true,
                qr_string: data.payment.payment_number,
                order_id: data.payment.order_id,
                expired_at: data.payment.expired_at
            };
        }
        return { error: 'No payment_number in response' };
    } catch (error) {
        return { error: error.message };
    }
}

const metValues = {
    'jogging': 7.0, 'lari': 9.8, 'bersepeda': 8.0, 'renang': 8.0,
    'yoga': 3.0, 'jalan kaki': 3.5, 'jalan cepat': 5.0, 'push up': 5.0,
    'sit up': 5.0, 'squat': 5.0, 'skipping': 11.0, 'angkat beban': 4.5,
    'badminton': 5.5, 'sepak bola': 7.0, 'basket': 6.5, 'zumba': 7.0,
    'pilates': 3.5, 'default': 4.0
};

function hitungKalori(olahraga, durasiMenit, beratBadan) {
    const olahragaKey = olahraga.toLowerCase().trim();
    let met = metValues['default'];
    for (const [key, value] of Object.entries(metValues)) {
        if (olahragaKey.includes(key)) { met = value; break; }
    }
    return Math.round(met * beratBadan * (durasiMenit / 60));
}

function hitungLemak(kalori) { return (kalori / 9).toFixed(1); }

const whoBMIData = {
    underweight: { status: 'Kurus', warna: '#f59e0b', icon: '⚠️', range: '<18.5', risk: 'Risiko kekurangan gizi, osteoporosis, anemia' },
    normal: { status: 'Normal', warna: '#10b981', icon: '✅', range: '18.5-24.9', risk: 'Risiko penyakit minimal' },
    overweight: { status: 'Gemuk Ringan', warna: '#f59e0b', icon: '⚠️', range: '25-29.9', risk: 'Risiko penyakit jantung, diabetes tipe 2 meningkat' },
    obese: { status: 'Obesitas', warna: '#ef4444', icon: '🚨', range: '≥30', risk: 'Risiko tinggi: penyakit jantung, stroke, diabetes' }
};

const app = express();
const PORT = process.env.PORT || 5000;

const MongoDBStore = MongoStore(session);
const sessionStore = new MongoDBStore({
    uri: MONGODB_URI,
    collection: 'sessions'
});

sessionStore.on('error', function(error) {
    console.error('Session store error:', error);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'health-app-secret-key-2025',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function requireLogin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

function requirePremium(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!req.session.isPremium) {
        return res.status(403).json({ error: 'Premium required' });
    }
    next();
}

const isVercel = process.env.VERCEL === '1';
const uploadDir = isVercel ? '/tmp/uploads' : path.join(__dirname, 'public/uploads');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `avatar_${req.session.userId}_${Date.now()}${ext}`);
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 2 * 1024 * 1024 } });

app.get('/', (req, res) => {
    if (req.session.userId) {
        res.redirect('/dashboard');
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/ai-chat', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public', 'ai-chat.html'));
});

app.get('/artikel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'artikel.html'));
});

app.use('/artikel', express.static(path.join(__dirname, 'public/artikel')));

app.get('/login.html', (req, res) => res.redirect('/login'));
app.get('/dashboard.html', (req, res) => res.redirect('/dashboard'));
app.get('/ai-chat.html', (req, res) => res.redirect('/ai-chat'));

app.get('/dev-panel', async (req, res) => {
    if (req.session.userId) {
        const user = await db.collection('users').findOne({ id: req.session.userId });
        if (user && user.email === DEVELOPER_EMAIL) {
            return res.sendFile(path.join(__dirname, 'public', 'dev-panel.html'));
        }
    }
    res.redirect('/');
});

app.post('/api/register', async (req, res) => {
    const { email, password, nama } = req.body;
    if (!email || !password || !nama) {
        return res.status(400).json({ error: 'Semua field harus diisi' });
    }
    
    try {
        const existingUser = await db.collection('users').findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email sudah terdaftar' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            id: Date.now(),
            email,
            password: hashedPassword,
            nama,
            umur: null,
            berat_badan: null,
            tinggi_badan: null,
            lingkar_pinggang: null,
            is_premium: false,
            premium_until: null,
            avatar: null,
            created_at: new Date().toISOString()
        };
        
        await db.collection('users').insertOne(newUser);
        res.json({ success: true, message: 'Register berhasil, silakan login' });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Terjadi kesalahan' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email dan password harus diisi' });
    }
    
    try {
        const user = await db.collection('users').findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Email tidak terdaftar' });
        }
        
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ error: 'Email atau password salah' });
        }
        
        if (email === DEVELOPER_EMAIL && !user.is_premium) {
            await db.collection('users').updateOne(
                { id: user.id },
                { $set: { is_premium: true, premium_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() } }
            );
            user.is_premium = true;
        }
        
        req.session.userId = user.id;
        req.session.userEmail = user.email;
        req.session.userNama = user.nama;
        req.session.isPremium = user.is_premium || false;
        res.json({ success: true });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Terjadi kesalahan' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Gagal logout' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

app.get('/api/user', requireLogin, async (req, res) => {
    try {
        const user = await db.collection('users').findOne(
            { id: req.session.userId },
            { projection: { password: 0 } }
        );
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
        res.json({ ...user, isPremium: user.is_premium });
    } catch (err) {
        res.status(500).json({ error: 'Terjadi kesalahan' });
    }
});

app.post('/api/update-health', requireLogin, async (req, res) => {
    const { umur, berat_badan, tinggi_badan } = req.body;
    
    try {
        const oldUser = await db.collection('users').findOne({ id: req.session.userId });
        const oldBerat = oldUser?.berat_badan;
        
        await db.collection('users').updateOne(
            { id: req.session.userId },
            { $set: { umur, berat_badan, tinggi_badan } }
        );
        
        if (oldBerat && oldBerat !== berat_badan) {
            const bmi = berat_badan / ((tinggi_badan / 100) ** 2);
            await db.collection('health_history').insertOne({
                user_id: req.session.userId,
                tanggal: new Date().toISOString().split('T')[0],
                berat_badan: parseFloat(berat_badan),
                bmi: bmi
            });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Update health error:', err);
        res.status(500).json({ error: 'Terjadi kesalahan' });
    }
});

app.post('/api/update-waist', requireLogin, async (req, res) => {
    const { lingkar_pinggang } = req.body;
    if (!lingkar_pinggang || lingkar_pinggang < 50 || lingkar_pinggang > 300) {
        return res.status(400).json({ error: 'Valid waist: 50-300 cm' });
    }
    
    try {
        await db.collection('users').updateOne(
            { id: req.session.userId },
            { $set: { lingkar_pinggang: parseFloat(lingkar_pinggang) } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Terjadi kesalahan' });
    }
});

app.get('/api/whr', requireLogin, async (req, res) => {
    try {
        const user = await db.collection('users').findOne({ id: req.session.userId });
        if (!user || !user.tinggi_badan || !user.lingkar_pinggang) {
            return res.json({ hasData: false });
        }
        
        const whtr = (user.lingkar_pinggang / user.tinggi_badan).toFixed(2);
        res.json({
            hasData: true,
            whtr: whtr,
            lingkarPinggang: user.lingkar_pinggang,
            tinggi: user.tinggi_badan
        });
    } catch (err) {
        res.json({ hasData: false });
    }
});

app.get('/api/health-status', requireLogin, async (req, res) => {
    const language = req.query.lang || 'id';
    
    try {
        const user = await db.collection('users').findOne({ id: req.session.userId });
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
        
        if (!user.berat_badan || !user.tinggi_badan) {
            return res.json({ hasData: false, message: language === 'id' ? 'Lengkapi data kesehatan terlebih dahulu' : 'Complete your health data first' });
        }
        
        const bmi = user.berat_badan / ((user.tinggi_badan / 100) ** 2);
        const category = getBMICategory(bmi);
        const bmiData = whoBMIData[category];
        const exerciseData = getLocalizedExerciseRecommendation(category, language);
        const nutritionData = getLocalizedNutritionRecommendation(category, language);
        
        const isPremium = user.is_premium;
        const premiumExercise = isPremium ? getLocalizedPremiumExercise(category, language) : null;
        const randomTip = isPremium ? (language === 'id' ? premiumHealthTips.id : premiumHealthTips.en)[Math.floor(Math.random() * 10)] : null;
        
        res.json({
            hasData: true,
            nama: user.nama,
            umur: user.umur || '-',
            berat: user.berat_badan,
            tinggi: user.tinggi_badan,
            bmi: bmi.toFixed(1),
            bmiRange: bmiData.range,
            status: getLocalizedHealthStatus(category, language),
            statusColor: bmiData.warna,
            statusIcon: bmiData.icon,
            statusPesan: getLocalizedRiskMessage(category, language),
            rekomendasiOlahraga: exerciseData.olahraga,
            rekomendasiFrekuensi: exerciseData.frekuensi,
            rekomendasiTips: exerciseData.tips,
            rekomendasiBenefit: exerciseData.benefit,
            rekomendasiMakanan: nutritionData,
            isPremium: isPremium,
            premiumExercise: premiumExercise,
            premiumTip: randomTip
        });
    } catch (err) {
        console.error('Health status error:', err);
        res.status(500).json({ error: 'Terjadi kesalahan' });
    }
});

app.post('/api/checkin', requireLogin, async (req, res) => {
    const { olahraga, durasi_menit, catatan } = req.body;
    const today = new Date().toISOString().split('T')[0];
    
    try {
        const user = await db.collection('users').findOne({ id: req.session.userId });
        const beratBadan = user?.berat_badan || 70;
        
        const kaloriBaru = hitungKalori(olahraga, durasi_menit, beratBadan);
        const lemakBaru = hitungLemak(kaloriBaru);
        
        const existingActivity = await db.collection('activities').findOne({
            user_id: req.session.userId,
            tanggal: today
        });
        
        if (existingActivity) {
            const olahragaGabungan = existingActivity.olahraga + ', ' + olahraga;
            const durasiGabungan = existingActivity.durasi_menit + parseInt(durasi_menit);
            const kaloriGabungan = (existingActivity.kalori_terbakar || 0) + kaloriBaru;
            const lemakGabungan = parseFloat(existingActivity.lemak_terbakar_gram || 0) + parseFloat(lemakBaru);
            const catatanGabungan = existingActivity.catatan + (catatan ? '; ' + catatan : '');
            
            await db.collection('activities').updateOne(
                { _id: existingActivity._id },
                { $set: {
                    olahraga: olahragaGabungan,
                    durasi_menit: durasiGabungan,
                    kalori_terbakar: kaloriGabungan,
                    lemak_terbakar_gram: lemakGabungan,
                    catatan: catatanGabungan,
                    updated_at: new Date().toISOString()
                }}
            );
            
            res.json({
                success: true,
                message: `✅ Update berhasil! Total hari ini: ${olahragaGabungan} → 🔥 ${kaloriGabungan} kalori (~${lemakGabungan}g lemak)`,
                kalori: kaloriGabungan,
                lemak: lemakGabungan,
                isUpdate: true
            });
        } else {
            await db.collection('activities').insertOne({
                id: Date.now(),
                user_id: req.session.userId,
                tanggal: today,
                olahraga: olahraga,
                durasi_menit: parseInt(durasi_menit),
                kalori_terbakar: kaloriBaru,
                lemak_terbakar_gram: parseFloat(lemakBaru),
                catatan: catatan || '',
                created_at: new Date().toISOString()
            });
            
            res.json({
                success: true,
                message: `✅ Absen berhasil! ${olahraga} ${durasi_menit} menit → 🔥 ${kaloriBaru} kalori (~${lemakBaru}g lemak)`,
                kalori: kaloriBaru,
                lemak: lemakBaru,
                isUpdate: false
            });
        }
    } catch (err) {
        console.error('Checkin error:', err);
        res.status(500).json({ error: 'Terjadi kesalahan' });
    }
});

app.get('/api/today-activity', requireLogin, async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    try {
        const activity = await db.collection('activities').findOne({
            user_id: req.session.userId,
            tanggal: today
        });
        res.json(activity || null);
    } catch (err) {
        res.json(null);
    }
});

app.get('/api/history', requireLogin, async (req, res) => {
    try {
        const activities = await db.collection('activities')
            .find({ user_id: req.session.userId })
            .sort({ tanggal: -1 })
            .limit(30)
            .toArray();
        res.json(activities);
    } catch (err) {
        res.json([]);
    }
});

app.get('/api/health-history', requireLogin, async (req, res) => {
    try {
        const history = await db.collection('health_history')
            .find({ user_id: req.session.userId })
            .sort({ tanggal: 1 })
            .toArray();
        res.json(history.slice(-30));
    } catch (err) {
        res.json([]);
    }
});

app.post('/api/upload-avatar', requireLogin, upload.single('avatar'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const avatarUrl = `/uploads/${req.file.filename}`;
    
    try {
        await db.collection('users').updateOne(
            { id: req.session.userId },
            { $set: { avatar: avatarUrl } }
        );
        res.json({ success: true, avatarUrl });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update avatar' });
    }
});

app.get('/api/user-avatar', requireLogin, async (req, res) => {
    try {
        const user = await db.collection('users').findOne({ id: req.session.userId });
        res.json({ avatar: user?.avatar || null });
    } catch (err) {
        res.json({ avatar: null });
    }
});

app.get('/api/premium-status', requireLogin, async (req, res) => {
    try {
        const user = await db.collection('users').findOne({ id: req.session.userId });
        res.json({
            isPremium: user?.is_premium || false,
            premiumUntil: user?.premium_until || null
        });
    } catch (err) {
        res.json({ isPremium: false, premiumUntil: null });
    }
});

app.post('/api/upgrade-premium', requireLogin, async (req, res) => {
    try {
        const user = await db.collection('users').findOne({ id: req.session.userId });
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
        if (user.is_premium) return res.json({ success: true, message: 'Anda sudah member Premium!' });
        
        const orderId = `HEALTH-${Date.now()}-${user.id}`;
        const amount = 21899;
        
        const paymentData = await createPakasirTransaction(orderId, amount, user.nama, user.email);
        if (paymentData.error) return res.status(500).json({ error: `PakaSIR Error: ${paymentData.error}` });
        
        if (paymentData.success && paymentData.qr_string) {
            await db.collection('payments').insertOne({
                id: orderId,
                user_id: user.id,
                amount: amount,
                status: 'pending',
                qr_string: paymentData.qr_string,
                expired_at: paymentData.expired_at,
                created_at: new Date().toISOString()
            });
            res.json({ success: true, qr_string: paymentData.qr_string, order_id: orderId, expired_at: paymentData.expired_at });
        } else {
            res.status(500).json({ error: paymentData.message || 'Gagal membuat pembayaran' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Gagal memproses pembayaran: ' + error.message });
    }
});

app.post('/api/payment-webhook', async (req, res) => {
    const { order_id, status } = req.body;
    try {
        const payment = await db.collection('payments').findOne({ id: order_id });
        if (payment && (status === 'success' || status === 'paid')) {
            await db.collection('payments').updateOne(
                { id: order_id },
                { $set: { status: 'success', completed_at: new Date().toISOString() } }
            );
            await db.collection('users').updateOne(
                { id: payment.user_id },
                { $set: {
                    is_premium: true,
                    premium_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                }}
            );
        }
        res.sendStatus(200);
    } catch (err) {
        res.sendStatus(200);
    }
});

app.get('/api/payment-status/:orderId', async (req, res) => {
    const { orderId } = req.params;
    try {
        const payment = await db.collection('payments').findOne({ id: orderId });
        res.json({ status: payment?.status || 'not_found' });
    } catch (err) {
        res.json({ status: 'not_found' });
    }
});

app.post('/api/ai/chat', requirePremium, async (req, res) => {
    const { message, forceLanguage } = req.body;
    if (!message) return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
    
    let language = detectLanguage(message);
    if (forceLanguage && (forceLanguage === 'id' || forceLanguage === 'en')) {
        language = forceLanguage;
    }
    
    console.log(`[AI] Message: "${message.substring(0, 50)}..." | Language: ${language}`);
    const result = await callAIApi(message, language);
    
    if (result.success) {
        res.json({ success: true, response: result.response, detectedLanguage: language });
    } else {
        res.status(500).json({ error: result.error || 'Gagal memproses permintaan' });
    }
});

app.get('/api/export-data', requireLogin, async (req, res) => {
    try {
        const user = await db.collection('users').findOne({ id: req.session.userId });
        const activities = await db.collection('activities').find({ user_id: req.session.userId }).toArray();
        const history = await db.collection('health_history').find({ user_id: req.session.userId }).toArray();
        
        let csv = 'Data Pengguna\n';
        csv += `Nama,${user.nama}\nEmail,${user.email}\nUmur,${user.umur || '-'}\nBerat Badan,${user.berat_badan || '-'} kg\nTinggi Badan,${user.tinggi_badan || '-'} cm\n\n`;
        csv += 'Riwayat Berat Badan\nTanggal,Berat (kg),BMI\n';
        history.forEach(h => { csv += `${h.tanggal},${h.berat_badan},${h.bmi?.toFixed(1) || '-'}\n`; });
        csv += '\nRiwayat Aktivitas Olahraga\nTanggal,Olahraga,Durasi (menit),Kalori Terbakar,Lemak Terbakar (g),Catatan\n';
        activities.forEach(a => { csv += `${a.tanggal},${a.olahraga},${a.durasi_menit},${a.kalori_terbakar || 0},${a.lemak_terbakar_gram || 0},${a.catatan || '-'}\n`; });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=health-data.csv');
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: 'Gagal export data' });
    }
});

app.get('/api/export-pdf', requireLogin, async (req, res) => {
    try {
        const user = await db.collection('users').findOne({ id: req.session.userId });
        const activities = await db.collection('activities')
            .find({ user_id: req.session.userId })
            .sort({ tanggal: -1 })
            .limit(30)
            .toArray();
        const healthHistory = await db.collection('health_history')
            .find({ user_id: req.session.userId })
            .sort({ tanggal: 1 })
            .toArray();
        
        let totalCalories = 0;
        activities.forEach(a => { totalCalories += a.kalori_terbakar || 0; });
        const totalActivities = activities.length;
        const avgCalories = totalActivities > 0 ? Math.round(totalCalories / totalActivities) : 0;
        
        let bmi = '-';
        let bmiCategory = '-';
        if (user.berat_badan && user.tinggi_badan) {
            bmi = (user.berat_badan / ((user.tinggi_badan / 100) ** 2)).toFixed(1);
            if (bmi < 18.5) bmiCategory = 'Kurus';
            else if (bmi < 25) bmiCategory = 'Normal';
            else if (bmi < 30) bmiCategory = 'Gemuk Ringan';
            else bmiCategory = 'Obesitas';
        }
        
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=laporan-kesehatan-${user.nama}-${Date.now()}.pdf`);
        doc.pipe(res);
        
        doc.fontSize(22).fillColor('#4f46e5').text('HealthCare+', { align: 'center' });
        doc.fontSize(14).fillColor('#64748b').text('Laporan Kesehatan Personal', { align: 'center' });
        doc.fontSize(10).fillColor('#94a3b8').text(`Dibuat pada: ${new Date().toLocaleDateString('id-ID')}`, { align: 'center' });
        doc.moveDown(2);
        doc.strokeColor('#4f46e5').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();
        
        doc.fontSize(14).fillColor('#1e293b').text('Data Pengguna', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#333');
        doc.text(`Nama: ${user.nama || '-'}`);
        doc.text(`Email: ${user.email || '-'}`);
        doc.text(`Berat Badan: ${user.berat_badan ? user.berat_badan + ' kg' : '-'}`);
        doc.text(`Tinggi Badan: ${user.tinggi_badan ? user.tinggi_badan + ' cm' : '-'}`);
        doc.text(`BMI: ${bmi} (${bmiCategory})`);
        doc.moveDown();
        
        doc.fontSize(14).fillColor('#1e293b').text('Ringkasan Statistik', { underline: true });
        doc.moveDown(0.5);
        
        const startX = 50;
        const colWidth = 150;
        const rowY = doc.y;
        
        doc.fontSize(10).fillColor('#fff');
        doc.rect(startX, rowY, colWidth, 30).fill('#4f46e5');
        doc.rect(startX + colWidth, rowY, colWidth, 30).fill('#f59e0b');
        doc.rect(startX + colWidth * 2, rowY, colWidth, 30).fill('#10b981');
        
        doc.fillColor('white');
        doc.text('Total Olahraga', startX + 10, rowY + 10, { width: colWidth - 20, align: 'center' });
        doc.text('Total Kalori', startX + colWidth + 10, rowY + 10, { width: colWidth - 20, align: 'center' });
        doc.text('Rata-rata/hari', startX + colWidth * 2 + 10, rowY + 10, { width: colWidth - 20, align: 'center' });
        
        doc.fillColor('#1e293b');
        doc.fontSize(14).font('Helvetica-Bold');
        doc.text(totalActivities.toString(), startX + 10, rowY + 40, { width: colWidth - 20, align: 'center' });
        doc.text(totalCalories.toLocaleString(), startX + colWidth + 10, rowY + 40, { width: colWidth - 20, align: 'center' });
        doc.text(avgCalories.toLocaleString(), startX + colWidth * 2 + 10, rowY + 40, { width: colWidth - 20, align: 'center' });
        
        doc.fontSize(10).font('Helvetica');
        doc.y = rowY + 70;
        doc.moveDown();
        
        const last7Days = [];
        const calories7Days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            last7Days.push(dateStr.slice(5));
            const activity = activities.find(a => a.tanggal === dateStr);
            calories7Days.push(activity ? (activity.kalori_terbakar || 0) : 0);
        }
        
        doc.fontSize(14).fillColor('#1e293b').text('Tren Kalori 7 Hari Terakhir', { underline: true });
        doc.moveDown(0.5);
        
        const calStartX = 50;
        const calColWidth = 70;
        const calRowY = doc.y;
        
        doc.fontSize(9).fillColor('#fff');
        for (let i = 0; i < 7; i++) {
            doc.rect(calStartX + (calColWidth * i), calRowY, calColWidth, 25).fill('#4f46e5');
            doc.fillColor('white').text(last7Days[i], calStartX + (calColWidth * i) + 5, calRowY + 7, { width: calColWidth - 10, align: 'center' });
        }
        
        doc.fillColor('#1e293b');
        for (let i = 0; i < 7; i++) {
            doc.text(calories7Days[i].toLocaleString(), calStartX + (calColWidth * i) + 5, calRowY + 32, { width: calColWidth - 10, align: 'center' });
        }
        
        doc.y = calRowY + 55;
        doc.moveDown();
        
        if (healthHistory.length > 0) {
            doc.fontSize(14).fillColor('#1e293b').text('Progress Berat Badan', { underline: true });
            doc.moveDown(0.5);
            
            const weightStartX = 50;
            const weightColWidth = 70;
            const weightRowY = doc.y;
            
            doc.fontSize(9).fillColor('#fff');
            for (let i = 0; i < Math.min(healthHistory.length, 10); i++) {
                doc.rect(weightStartX + (weightColWidth * i), weightRowY, weightColWidth, 25).fill('#4f46e5');
                doc.fillColor('white').text(healthHistory[i].tanggal.slice(5), weightStartX + (weightColWidth * i) + 5, weightRowY + 7, { width: weightColWidth - 10, align: 'center' });
            }
            
            doc.fillColor('#1e293b');
            for (let i = 0; i < Math.min(healthHistory.length, 10); i++) {
                doc.text(`${healthHistory[i].berat_badan} kg`, weightStartX + (weightColWidth * i) + 5, weightRowY + 32, { width: weightColWidth - 10, align: 'center' });
            }
            
            doc.y = weightRowY + 55;
            doc.moveDown();
        }
        
        doc.fontSize(14).fillColor('#1e293b').text('Riwayat Aktivitas (30 hari terakhir)', { underline: true });
        doc.moveDown(0.5);
        
        if (activities.length === 0) {
            doc.fontSize(10).fillColor('#94a3b8').text('Belum ada data aktivitas.', { align: 'center' });
        } else {
            const actStartX = 50;
            const actColWidths = [80, 180, 60, 70];
            const actRowY = doc.y;
            
            doc.fontSize(9).fillColor('#fff');
            doc.rect(actStartX, actRowY, actColWidths[0], 25).fill('#4f46e5');
            doc.rect(actStartX + actColWidths[0], actRowY, actColWidths[1], 25).fill('#4f46e5');
            doc.rect(actStartX + actColWidths[0] + actColWidths[1], actRowY, actColWidths[2], 25).fill('#4f46e5');
            doc.rect(actStartX + actColWidths[0] + actColWidths[1] + actColWidths[2], actRowY, actColWidths[3], 25).fill('#4f46e5');
            
            doc.fillColor('white');
            doc.text('Tanggal', actStartX + 5, actRowY + 7, { width: actColWidths[0] - 10, align: 'center' });
            doc.text('Aktivitas', actStartX + actColWidths[0] + 5, actRowY + 7, { width: actColWidths[1] - 10, align: 'center' });
            doc.text('Durasi', actStartX + actColWidths[0] + actColWidths[1] + 5, actRowY + 7, { width: actColWidths[2] - 10, align: 'center' });
            doc.text('Kalori', actStartX + actColWidths[0] + actColWidths[1] + actColWidths[2] + 5, actRowY + 7, { width: actColWidths[3] - 10, align: 'center' });
            
            doc.fillColor('#1e293b');
            let currentY = actRowY + 30;
            for (let i = 0; i < Math.min(activities.length, 15); i++) {
                const a = activities[i];
                doc.text(a.tanggal, actStartX + 5, currentY, { width: actColWidths[0] - 10 });
                doc.text(a.olahraga.substring(0, 25), actStartX + actColWidths[0] + 5, currentY, { width: actColWidths[1] - 10 });
                doc.text(`${a.durasi_menit} menit`, actStartX + actColWidths[0] + actColWidths[1] + 5, currentY, { width: actColWidths[2] - 10 });
                doc.text(`${(a.kalori_terbakar || 0).toLocaleString()} kal`, actStartX + actColWidths[0] + actColWidths[1] + actColWidths[2] + 5, currentY, { width: actColWidths[3] - 10 });
                currentY += 20;
                
                if (currentY > 700 && i < activities.length - 1) {
                    doc.addPage();
                    currentY = 50;
                }
            }
        }
        
        doc.addPage();
        doc.fontSize(12).fillColor('#ef4444').text('Disclaimer Medis', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(9).fillColor('#64748b').text(
            'Laporan ini bersifat informatif dan didasarkan pada data yang Anda masukkan. ' +
            'HealthCare+ bukan pengganti konsultasi medis profesional. Selalu konsultasikan dengan dokter.',
            { align: 'center' }
        );
        doc.moveDown();
        doc.fontSize(8).fillColor('#94a3b8').text('Sumber data: WHO, ACSM, FAO', { align: 'center' });
        doc.moveDown();
        doc.fontSize(8).fillColor('#94a3b8').text('(c) 2025 HealthCare+ — Platform Kesehatan Digital', { align: 'center' });
        
        doc.end();
    } catch (err) {
        console.error('PDF export error:', err);
        res.status(500).json({ error: 'Gagal generate PDF' });
    }
});

app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email harus diisi' });
    
    try {
        const user = await db.collection('users').findOne({ email });
        if (!user) return res.status(404).json({ error: 'Email tidak terdaftar' });
        
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + 3600000;
        
        await db.collection('reset_tokens').insertOne({
            email, token: resetToken, expiresAt, created_at: new Date().toISOString()
        });
        
        const resetLink = `http://localhost:${PORT}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
        const mailOptions = {
            from: `"HealthCare+ Support" <${EMAIL_CONFIG.user}>`,
            to: email,
            subject: 'Reset Password - HealthCare+',
            html: `<div style="font-family:Arial;max-width:500px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:16px;"><div style="text-align:center;margin-bottom:20px;"><h2 style="color:#4f46e5;">🏥 HealthCare+</h2></div><p>Halo ${user.nama},</p><p>Kami menerima permintaan untuk mereset password akun Anda.</p><div style="text-align:center;margin:30px 0;"><a href="${resetLink}" style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:12px 24px;text-decoration:none;border-radius:40px;">Reset Password</a></div><p>Link ini berlaku 1 jam.</p><p>Jika Anda tidak meminta reset password, abaikan email ini.</p><hr style="margin:20px 0;"><p style="font-size:12px;color:#6b7280;">© 2025 HealthCare+</p></div>`
        };
        
        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Link reset password telah dikirim ke email Anda.' });
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengirim email. Silakan coba lagi.' });
    }
});

app.get('/reset-password', (req, res) => {
    const { token, email } = req.query;
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Reset Password</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Inter',sans-serif;background:linear-gradient(135deg,#4f46e5,#7c3aed);min-height:100vh;display:flex;justify-content:center;align-items:center;padding:20px;}.card{background:white;border-radius:24px;padding:40px;max-width:400px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);}.card h1{font-size:24px;margin-bottom:20px;color:#1f2937;}.input-group{margin-bottom:20px;}.input-group label{display:block;margin-bottom:8px;font-weight:500;color:#374151;}.input-group input{width:100%;padding:12px 16px;border:2px solid #e5e7eb;border-radius:12px;font-size:14px;}.btn{width:100%;padding:12px;background:linear-gradient(135deg,#4f46e5,#7c3aed);border:none;border-radius:40px;color:white;font-weight:600;cursor:pointer;}.error{color:#ef4444;font-size:12px;margin-top:8px;text-align:center;}.success{color:#10b981;font-size:12px;margin-top:8px;text-align:center;}</style></head><body><div class="card"><h1>Reset Password</h1><div class="input-group"><label>Password Baru</label><input type="password" id="newPassword" placeholder="********"></div><div class="input-group"><label>Konfirmasi Password</label><input type="password" id="confirmPassword" placeholder="********"></div><button class="btn" onclick="resetPassword()">Reset Password</button><div id="message" class="error"></div></div><script>const urlParams=new URLSearchParams(window.location.search);const email=urlParams.get('email');const token=urlParams.get('token');async function resetPassword(){const newPassword=document.getElementById('newPassword').value;const confirmPassword=document.getElementById('confirmPassword').value;const msg=document.getElementById('message');if(!newPassword||!confirmPassword){msg.textContent='Isi semua field';msg.className='error';return;}if(newPassword!==confirmPassword){msg.textContent='Password tidak cocok';msg.className='error';return;}const res=await fetch('/api/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,token,newPassword})});const data=await res.json();if(res.ok){msg.textContent=data.message;msg.className='success';setTimeout(()=>{window.location.href='/';},2000);}else{msg.textContent=data.error;msg.className='error';}}</script></body></html>`);
});

app.post('/api/reset-password', async (req, res) => {
    const { email, token, newPassword } = req.body;
    if (!email || !token || !newPassword) return res.status(400).json({ error: 'Data tidak lengkap' });
    
    try {
        const tokenRecord = await db.collection('reset_tokens').findOne({ email, token });
        if (!tokenRecord) return res.status(400).json({ error: 'Token tidak valid' });
        if (tokenRecord.expiresAt < Date.now()) return res.status(400).json({ error: 'Token sudah kadaluarsa' });
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.collection('users').updateOne({ email }, { $set: { password: hashedPassword } });
        await db.collection('reset_tokens').deleteOne({ email, token });
        
        res.json({ success: true, message: 'Password berhasil direset! Silakan login.' });
    } catch (err) {
        res.status(500).json({ error: 'Terjadi kesalahan' });
    }
});

app.get('/api/dev/users', requireLogin, async (req, res) => {
    const user = await db.collection('users').findOne({ id: req.session.userId });
    if (!user || user.email !== DEVELOPER_EMAIL) return res.status(403).json({ error: 'Akses hanya untuk developer' });
    
    const users = await db.collection('users').find({}, { projection: { password: 0 } }).toArray();
    res.json({ users, total: users.length });
});

app.get('/api/dev/activities', requireLogin, async (req, res) => {
    const user = await db.collection('users').findOne({ id: req.session.userId });
    if (!user || user.email !== DEVELOPER_EMAIL) return res.status(403).json({ error: 'Akses hanya untuk developer' });
    
    const activities = await db.collection('activities').find({}).toArray();
    res.json({ activities, total: activities.length });
});

app.delete('/api/dev/user/:userId', requireLogin, async (req, res) => {
    const developer = await db.collection('users').findOne({ id: req.session.userId });
    if (!developer || developer.email !== DEVELOPER_EMAIL) return res.status(403).json({ error: 'Akses hanya untuk developer' });
    
    const targetUserId = parseInt(req.params.userId);
    if (targetUserId === req.session.userId) return res.status(400).json({ error: 'Tidak dapat menghapus akun developer sendiri' });
    
    const deletedUser = await db.collection('users').findOne({ id: targetUserId });
    if (!deletedUser) return res.status(404).json({ error: 'User tidak ditemukan' });
    
    await db.collection('users').deleteOne({ id: targetUserId });
    await db.collection('activities').deleteMany({ user_id: targetUserId });
    await db.collection('health_history').deleteMany({ user_id: targetUserId });
    
    res.json({ success: true, message: `User ${deletedUser.nama} (${deletedUser.email}) telah dihapus` });
});

app.get('/api/dev/stats', requireLogin, async (req, res) => {
    const user = await db.collection('users').findOne({ id: req.session.userId });
    if (!user || user.email !== DEVELOPER_EMAIL) return res.status(403).json({ error: 'Akses hanya untuk developer' });
    
    const totalUsers = await db.collection('users').countDocuments();
    const premiumUsers = await db.collection('users').countDocuments({ is_premium: true });
    const totalActivities = await db.collection('activities').countDocuments();
    const activities = await db.collection('activities').find({}).toArray();
    let totalCalories = 0;
    activities.forEach(a => { totalCalories += a.kalori_terbakar || 0; });
    
    res.json({
        totalUsers, premiumUsers, freeUsers: totalUsers - premiumUsers,
        totalActivities, totalCalories: totalCalories.toLocaleString()
    });
});

app.post('/api/dev/set-premium', requireLogin, async (req, res) => {
    const developer = await db.collection('users').findOne({ id: req.session.userId });
    if (!developer || developer.email !== DEVELOPER_EMAIL) return res.status(403).json({ error: 'Akses hanya untuk developer' });
    
    const { email, isPremium, durationDays } = req.body;
    const targetUser = await db.collection('users').findOne({ email });
    if (!targetUser) return res.status(404).json({ error: 'User tidak ditemukan' });
    
    const updateData = { is_premium: isPremium === true || isPremium === 'true' };
    if (updateData.is_premium && durationDays) {
        updateData.premium_until = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    } else if (updateData.is_premium) {
        updateData.premium_until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    } else {
        updateData.premium_until = null;
    }
    
    await db.collection('users').updateOne({ email }, { $set: updateData });
    res.json({ success: true, message: `Premium status untuk ${email} diubah` });
});

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`✅ Server running on http://localhost:${PORT}`);
        console.log(`✅ MongoDB connected`);
        console.log(`✅ Using ${isVercel ? '/tmp/uploads' : 'local'} for uploads`);
        console.log(`✅ Session stored in MongoDB`);
        console.log(`👑 Developer: ${DEVELOPER_EMAIL}`);
    });
});
