// ========== EXPORT PDF dengan PDFKit ==========
const PDFDocument = require('pdfkit');

app.get('/api/export-pdf', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = usersDB.data.users.find(u => u.id === req.session.userId);
    const activities = activitiesDB.data.activities
        .filter(a => a.user_id === req.session.userId)
        .sort((a, b) => b.tanggal.localeCompare(a.tanggal))
        .slice(0, 30);
    const healthHistory = healthHistoryDB.data.history
        .filter(h => h.user_id === req.session.userId)
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal));
    
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
    
    // Buat PDF
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=laporan-kesehatan-${user.nama}-${Date.now()}.pdf`);
    
    // Pipe PDF ke response
    doc.pipe(res);
    
    // Header
    doc.fontSize(22).fillColor('#4f46e5').text('HealthCare+', { align: 'center' });
    doc.fontSize(14).fillColor('#64748b').text('Laporan Kesehatan Personal', { align: 'center' });
    doc.fontSize(10).fillColor('#94a3b8').text(`Dibuat pada: ${new Date().toLocaleDateString('id-ID')}`, { align: 'center' });
    doc.moveDown(2);
    
    // Garis pemisah
    doc.strokeColor('#4f46e5').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();
    
    // Data Pengguna
    doc.fontSize(14).fillColor('#1e293b').text('📋 Data Pengguna', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#333');
    doc.text(`Nama: ${user.nama || '-'}`, { continued: true }).text(`Email: ${user.email || '-'}`, { align: 'right' });
    doc.text(`Berat Badan: ${user.berat_badan ? user.berat_badan + ' kg' : '-'}`, { continued: true }).text(`Tinggi Badan: ${user.tinggi_badan ? user.tinggi_badan + ' cm' : '-'}`, { align: 'right' });
    doc.text(`BMI: ${bmi} (${bmiCategory})`);
    doc.moveDown();
    
    // Ringkasan Statistik
    doc.fontSize(14).fillColor('#1e293b').text('📊 Ringkasan Statistik', { underline: true });
    doc.moveDown(0.5);
    
    // Buat tabel ringkasan
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
    
    // Tren Kalori 7 Hari
    doc.fontSize(14).fillColor('#1e293b').text('🔥 Tren Kalori 7 Hari Terakhir', { underline: true });
    doc.moveDown(0.5);
    
    // Hitung data 7 hari terakhir
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
    
    // Tabel kalori
    const calStartX = 50;
    const calColWidth = 70;
    const calRowY = doc.y;
    
    // Header tabel
    doc.fontSize(9).fillColor('#fff');
    for (let i = 0; i < 7; i++) {
        doc.rect(calStartX + (calColWidth * i), calRowY, calColWidth, 25).fill('#4f46e5');
        doc.fillColor('white').text(last7Days[i], calStartX + (calColWidth * i) + 5, calRowY + 7, { width: calColWidth - 10, align: 'center' });
    }
    
    // Data kalori
    doc.fillColor('#1e293b');
    for (let i = 0; i < 7; i++) {
        doc.text(calories7Days[i].toLocaleString(), calStartX + (calColWidth * i) + 5, calRowY + 32, { width: calColWidth - 10, align: 'center' });
    }
    
    doc.y = calRowY + 55;
    doc.moveDown();
    
    // Progress Berat Badan (jika ada)
    if (healthHistory.length > 0) {
        doc.fontSize(14).fillColor('#1e293b').text('📈 Progress Berat Badan', { underline: true });
        doc.moveDown(0.5);
        
        const weightStartX = 50;
        const weightColWidth = 70;
        const weightRowY = doc.y;
        
        doc.fontSize(9).fillColor('#fff');
        for (let i = 0; i < healthHistory.length; i++) {
            doc.rect(weightStartX + (weightColWidth * i), weightRowY, weightColWidth, 25).fill('#4f46e5');
            doc.fillColor('white').text(healthHistory[i].tanggal.slice(5), weightStartX + (weightColWidth * i) + 5, weightRowY + 7, { width: weightColWidth - 10, align: 'center' });
        }
        
        doc.fillColor('#1e293b');
        for (let i = 0; i < healthHistory.length; i++) {
            doc.text(`${healthHistory[i].berat_badan} kg`, weightStartX + (weightColWidth * i) + 5, weightRowY + 32, { width: weightColWidth - 10, align: 'center' });
        }
        
        doc.y = weightRowY + 55;
        doc.moveDown();
    }
    
    // Riwayat Aktivitas
    doc.fontSize(14).fillColor('#1e293b').text('🏃 Riwayat Aktivitas (30 hari terakhir)', { underline: true });
    doc.moveDown(0.5);
    
    if (activities.length === 0) {
        doc.fontSize(10).fillColor('#94a3b8').text('Belum ada data aktivitas.', { align: 'center' });
    } else {
        // Header tabel aktivitas
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
            
            // Halaman baru jika penuh
            if (currentY > 700 && i < activities.length - 1) {
                doc.addPage();
                currentY = 50;
            }
        }
    }
    
    // Disclaimer
    doc.addPage();
    doc.fontSize(12).fillColor('#ef4444').text('⚠️ Disclaimer Medis', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#64748b').text(
        'Laporan ini bersifat informatif dan didasarkan pada data yang Anda masukkan ke dalam sistem. ' +
        'HealthCare+ bukan pengganti konsultasi medis profesional. Selalu konsultasikan dengan dokter atau tenaga medis berlisensi ' +
        'untuk kondisi kesehatan spesifik Anda.',
        { align: 'center' }
    );
    doc.moveDown();
    doc.fontSize(8).fillColor('#94a3b8').text('Sumber data: WHO (World Health Organization), ACSM (American College of Sports Medicine), FAO (Food and Agriculture Organization)', { align: 'center' });
    doc.moveDown();
    doc.fontSize(8).fillColor('#94a3b8').text(`© 2025 HealthCare+ — Platform Kesehatan Digital`, { align: 'center' });
    
    // Finalisasi PDF
    doc.end();
});
