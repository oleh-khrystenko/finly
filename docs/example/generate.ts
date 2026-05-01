import * as QRCode from 'qrcode';
import sharp from 'sharp';
import * as fs from 'fs';

// Synthetic placeholder data — purely illustrative. Не вводити сюди реальні
// реквізити навіть для тестів (файл потрапляє у git-історію). Для запуску з
// реальними даними — копіювати поза репо або підставляти через env.
const fopData = {
  name: 'ФОП ПРИКЛАДЕНКО ТЕСТ ТЕСТОВИЧ',
  iban: 'UA000000000000000000000000000',
  ipn: '0000000000',
  purpose: 'Оплата за товари без ПДВ',
  amount: '0', // Залиш "0", щоб клієнт сам вводив суму, або вкажи '1000'
};

async function generateNbuPayment() {
  // Важливо: не змінюй відступи та порожні рядки, вони є частиною формату.
  // 1. Формуємо пейлоад за стандартом НБУ. 
  const payload = [
    'BCD',                         // 0: Service Tag
    '002',                         // 1: Версія формату
    '1',                           // 2: Кодування (UTF-8)
    'UCT',                         // 3: Ідентифікатор
    '',                            // 4: BIC банку (порожньо)
    fopData.name,                  // 5: Назва отримувача
    fopData.iban,                  // 6: IBAN
    `UAH${fopData.amount || '0'}`, // 7: Валюта + Сума (КРИТИЧНО: склеєні разом)
    fopData.ipn,                   // 8: ІПН / ЄДРПОУ
    '',                            // 9: Код призначення (порожньо)
    '',                            // 10: Референс (порожньо)
    fopData.purpose,               // 11: Призначення платежу
    '',                            // 12: Закриття 1
    ''                             // 13: Закриття 2
  ].join('\n');

  // 2. Кодуємо у Base64URL (URL-safe формат без '+' та '/')
  const base64UrlPayload = Buffer.from(payload, 'utf-8').toString('base64url');

  // 3. Формуємо фінальне Deep Link посилання
  const paymentLink = `https://bank.gov.ua/qr/${base64UrlPayload}`;
  
  console.log('--- ПОСИЛАННЯ ДЛЯ МЕСЕНДЖЕРІВ ---');
  console.log(paymentLink);
  console.log('----------------------------------\n');

  // 4. Генеруємо візуальний QR-код для друку (накладні тощо)
  const fileName = `qr_${fopData.ipn}.png`;
  const logoPath = 'easy-fin-logo.jpg'; // Шлях до твого логотипу
  const qrSize = 500;
  // Логотип не повинен перевищувати 25-30% розміру QR-коду, щоб він зчитувався
  const logoWidth = Math.round(qrSize * 0.40);
  const logoHeight = Math.round(qrSize * 0.15);

  try {
    // 1. Генеруємо QR-код у пам'ять (буфер) замість файла.
    // КРИТИЧНО: errorCorrectionLevel: 'H' дозволяє перекрити центр
    const qrBuffer = await QRCode.toBuffer(paymentLink, {
      width: qrSize,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    // 2. Якщо логотип існує - накладаємо його
    if (fs.existsSync(logoPath)) {
      // Підганяємо розмір логотипу
      const resizedLogo = await sharp(logoPath)
          .resize(logoWidth, logoHeight, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 1 } // Біла підкладка
          })
          .toBuffer();

      // Компонуємо: малюємо логотип по центру QR-коду
      await sharp(qrBuffer)
          .composite([{ input: resizedLogo, gravity: 'center' }])
          .toFile(fileName);

      console.log(`✅ QR-код З ЛОГОТИПОМ успішно збережено: ${fileName}`);
    } else {
      // Якщо файл логотипу не знайдено, зберігаємо звичайний QR
      fs.writeFileSync(fileName, qrBuffer);
      console.log(`⚠️ Файл ${logoPath} не знайдено. Збережено звичайний QR-код: ${fileName}`);
    }

  } catch (error) {
    console.error('Помилка генерації зображення:', error);
  }
}

generateNbuPayment();