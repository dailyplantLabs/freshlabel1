/**
 * FreshLabel — Mega MGC Coffee Safety Storage Manual (2025.01 ver) Edition
 * Core Rules Implemented:
 *  1. 당일 포함(Inclusive of Opening/Manufacturing Day) Expiry Calculation:
 *     - N일 안전보관 = 시작일(1일차) 포함 N일째까지 = 시작일 + (N - 1)일
 *     - 예: 10/27 개봉, 안전보관 3일(당일포함) -> 10/27(1일), 10/28(2일), 10/29(3일) -> 10/29 까지!
 *     - 예: 10/27 제조, 안전보관 5일(당일포함) -> 10/31 까지!
 *     - 시간 단위 자재(삶은 펄 4H 등)는 시간 단위로 정확히 계산
 *  2. 1. 음료/디저트 자재 & 2. 베이커리 자재 전 품목 프리셋 및 안전보관일 기준표 탑재
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'freshlabel_mega_manual_v8';
  const printer = new window.LabelPrinterManager();

  let activeCameraStream = null;
  let currentItemPhotoDataUrl = null;
  let currentSlipPhotoDataUrl = null;
  let currentSlipDraftRows = [];

  // Utility: Date formatting helpers
  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatDateOnly(dateObj) {
    const y = dateObj.getFullYear();
    const m = pad2(dateObj.getMonth() + 1);
    const d = pad2(dateObj.getDate());
    return `${y}.${m}.${d}`;
  }

  function formatDateTime(dateObj) {
    const y = dateObj.getFullYear();
    const m = pad2(dateObj.getMonth() + 1);
    const d = pad2(dateObj.getDate());
    const hh = pad2(dateObj.getHours());
    const mm = pad2(dateObj.getMinutes());
    const ss = pad2(dateObj.getSeconds());
    return `${y}.${m}.${d} ${hh}:${mm}:${ss}`;
  }

  function formatShortDate(dateStr) {
    const parts = (dateStr || '').split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[1]}/${parts[2]}`;
  }

  function addDaysToDateStr(baseDate, daysToAdd) {
    const d = new Date(baseDate.getTime());
    d.setDate(d.getDate() + daysToAdd);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  /**
   * CRITICAL RULE: 당일 포함(Inclusive of Today) 소비기한 계산기 (실시간 시각 반영)
   * - 안전보관일이 N일(당일 포함)이면, 오늘이 1일차이므로 (N - 1)일을 더한 날짜가 만료일입니다.
   * - 예: 10월 27일에 안전보관 3일(당일포함) 품목 개봉 -> 10/27(1일차), 10/28(2일차), 10/29(3일차) -> 10월 29일 까지!
   * - 시간 단위(hours)가 지정된 품목(예: 삶은 펄 4H)은 시작 시각 + hours시간으로 실시간 계산합니다.
   */
  function calculateInclusiveExpiry(baseDate, preset) {
    const start = new Date(baseDate.getTime());

    if (preset.hours && preset.hours > 0) {
      const expTime = new Date(start.getTime() + preset.hours * 3600000);
      const expDateStr = `${expTime.getFullYear()}-${pad2(expTime.getMonth() + 1)}-${pad2(expTime.getDate())}`;
      const hmStr = `${pad2(expTime.getHours())}:${pad2(expTime.getMinutes())}:${pad2(expTime.getSeconds())}`;
      return {
        openedAtFormatted: formatDateTime(start),
        expiresAtFormatted: formatDateTime(expTime),
        expiresShortPreview: `${hmStr}까지`,
        expiresDateStr: expDateStr,
        ruleBadgeText: `${preset.hours}시간 (${hmStr}까지)`,
        ruleDetailText: `${preset.hours}시간`
      };
    }

    const safetyDays = Math.max(1, Number(preset.days) || 1);
    const addOffsetDays = safetyDays - 1; // 당일 포함이므로 (N - 1)일 가산!
    const expDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + addOffsetDays, 23, 59);
    const expDateStr = addDaysToDateStr(start, addOffsetDays);
    const startShort = `${pad2(start.getMonth() + 1)}/${pad2(start.getDate())}`;
    const expShort = `${pad2(expDate.getMonth() + 1)}/${pad2(expDate.getDate())}`;

    const ruleBadgeText =
      safetyDays === 1
        ? `당일폐기 (${expShort}까지)`
        : `당일포함 ${safetyDays}일 (${expShort}까지)`;

    return {
      openedAtFormatted: formatDateTime(start),
      expiresAtFormatted: formatDateOnly(expDate),
      expiresShortPreview: `${startShort}~${expShort}`,
      expiresDateStr: expDateStr,
      ruleBadgeText,
      ruleDetailText: `${safetyDays}일`
    };
  }

  function calcDDay(targetDateStr) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [y, m, d] = (targetDateStr || '').split('-').map(Number);
    if (!y || !m || !d) return 7;
    const targetStart = new Date(y, m - 1, d);
    const diffMs = targetStart - todayStart;
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  }

  // Generate synthetic product photo (Canvas DataURL)
  function generateProductPhotoDataUrl(title, subtitle, accentColor, expiryStr) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 340;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, 480, 340);

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(60, 26, 360, 288);

      ctx.fillStyle = accentColor || '#059669';
      ctx.fillRect(60, 26, 360, 64);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('입고 실물 촬영 사진 (검수완료)', 80, 65);

      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 25px sans-serif';
      ctx.fillText(title, 82, 138);

      ctx.fillStyle = '#475569';
      ctx.font = '600 15px sans-serif';
      ctx.fillText(subtitle || '메가MGC커피 식자재 안전보관 규격', 82, 170);

      ctx.fillStyle = '#FEF2F2';
      ctx.fillRect(82, 195, 316, 56);
      ctx.strokeStyle = '#DC2626';
      ctx.lineWidth = 2;
      ctx.strokeRect(82, 195, 316, 56);

      ctx.fillStyle = '#B91C1C';
      ctx.font = 'bold 17px monospace';
      ctx.fillText(`포장지 소비기한: ${expiryStr || '2026.11.05'} 까지`, 96, 229);

      ctx.fillStyle = '#64748B';
      ctx.font = '13px monospace';
      ctx.fillText(`촬영일시: ${formatDateTime(new Date())}`, 82, 290);

      return canvas.toDataURL('image/jpeg', 0.8);
    } catch (_) {
      return '';
    }
  }

  // Generate photographed Delivery Slip (거래명세서/입고리스트) image
  function generateDeliverySlipPhotoDataUrl(supplierName, items, dateTimeStr) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 540;
      canvas.height = 680;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#1E293B';
      ctx.fillRect(0, 0, 540, 680);

      ctx.fillStyle = '#FFFDF9';
      ctx.fillRect(36, 28, 468, 624);

      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(54, 48, 432, 584);

      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText('거 래 명 세 서 (입고리스트)', 110, 94);

      ctx.font = '600 14px sans-serif';
      ctx.fillStyle = '#334155';
      ctx.fillText(`납품처: ${supplierName}`, 72, 132);
      ctx.fillText(`입고일시: ${dateTimeStr}`, 72, 154);

      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(68, 174, 404, 34);
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('품목명', 80, 196);
      ctx.fillText('소비기한', 250, 196);
      ctx.fillText('수량', 365, 196);
      ctx.fillText('검수', 420, 196);

      items.forEach((item, idx) => {
        const y = 236 + idx * 44;
        ctx.fillStyle = '#0F172A';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText(item.name, 80, y);
        ctx.font = '14px monospace';
        ctx.fillText(item.expiryDate, 245, y);
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText(`${item.qty}개`, 365, y);
        ctx.fillStyle = '#059669';
        ctx.fillText('확인', 420, y);

        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(68, y + 14);
        ctx.lineTo(472, y + 14);
        ctx.stroke();
      });

      ctx.strokeStyle = '#DC2626';
      ctx.lineWidth = 3;
      ctx.strokeRect(320, 520, 134, 68);
      ctx.fillStyle = '#DC2626';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('입고검수완료', 333, 552);
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('FreshLabel 보관됨', 335, 574);

      return canvas.toDataURL('image/jpeg', 0.82);
    } catch (_) {
      return '';
    }
  }

  function resizeImageFileToDataUrl(file, maxWidth = 720) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxWidth / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function stopCameraStreams() {
    if (activeCameraStream) {
      activeCameraStream.getTracks().forEach((track) => track.stop());
      activeCameraStream = null;
    }
    const v1 = document.getElementById('itemCameraVideo');
    const v2 = document.getElementById('slipCameraVideo');
    if (v1) v1.style.display = 'none';
    if (v2) v2.style.display = 'none';
    const b1 = document.getElementById('itemCameraShutterBar');
    const b2 = document.getElementById('slipCameraShutterBar');
    if (b1) b1.style.display = 'none';
    if (b2) b2.style.display = 'none';
  }

  // ==========================================================================
  // Complete Mega MGC Coffee 2025.01 Safety Storage Manual Seed Data
  // (소분된 내용물이 모두 다르므로 묶지 않고 전 품목 1:1 개별 분리 저장)
  // ==========================================================================
  function createDefaultPresets() {
    return [
      // --- 1. 물 베이스 (개별 분리 · 제조 후 당일포함 5일 · 냉장) ---
      { id: 'preset-sugar-base', category: '물베이스', actionType: '제조', title: '설탕베이스 (제조)', fullName: '설탕베이스 (제조)', days: 5, storage: '냉장 (0~10℃)', note: '물 베이스 제조 후 당일포함 5일', isFav: true },
      { id: 'preset-choco-base', category: '물베이스', actionType: '제조', title: '초코베이스 (제조)', fullName: '초코베이스 (제조)', days: 5, storage: '냉장 (0~10℃)', note: '물 베이스 제조 후 당일포함 5일', isFav: true },
      { id: 'preset-peach-base', category: '물베이스', actionType: '제조', title: '복숭아베이스 (제조)', fullName: '복숭아베이스 (제조)', days: 5, storage: '냉장 (0~10℃)', note: '물 베이스 제조 후 당일포함 5일', isFav: false },
      { id: 'preset-icetea-base', category: '물베이스', actionType: '제조', title: '아이스티베이스 (제조)', fullName: '아이스티베이스 (제조)', days: 5, storage: '냉장 (0~10℃)', note: '물 베이스 제조 후 당일포함 5일', isFav: false },
      { id: 'preset-greentea-base', category: '물베이스', actionType: '제조', title: '녹차베이스 (제조)', fullName: '녹차베이스 (제조)', days: 5, storage: '냉장 (0~10℃)', note: '물 베이스 제조 후 당일포함 5일', isFav: false },

      // --- 2. 우유 베이스 & 크림 (전 품목 개별 분리 · 냉장) ---
      { id: 'preset-milk', category: '우유·크림', actionType: '개봉', title: '우유 1L (개봉)', fullName: '우유 1L (개봉)', days: 3, storage: '냉장 (0~10℃)', note: '개봉 후 당일포함 3일', isFav: true },
      { id: 'preset-whip-cream', category: '우유·크림', actionType: '제조', title: '일반 휘핑크림 (제조)', fullName: '일반 휘핑크림 (제조)', days: 3, storage: '냉장 (0~10℃)', note: '제조 후 당일포함 3일', isFav: true },
      { id: 'preset-fresh-cream', category: '우유·크림', actionType: '개봉', title: '생크림 (개봉)', fullName: '생크림 (개봉)', days: 3, storage: '냉장 (0~10℃)', note: '개봉 후 당일포함 3일', isFav: true },
      { id: 'preset-cookie-milk-base', category: '우유·크림', actionType: '제조', title: '쿠키베이스 (제조)', fullName: '쿠키 우유베이스 (제조)', days: 3, storage: '냉장 (0~10℃)', note: '제조 후 당일포함 3일', isFav: false },
      { id: 'preset-coconut-milk-base', category: '우유·크림', actionType: '제조', title: '코코넛베이스 (제조)', fullName: '코코넛 우유베이스 (제조)', days: 3, storage: '냉장 (0~10℃)', note: '제조 후 당일포함 3일', isFav: false },
      { id: 'preset-milkshake-base', category: '우유·크림', actionType: '제조', title: '밀크쉐이크베이스 (제조)', fullName: '밀크쉐이크 우유베이스 (제조)', days: 3, storage: '냉장 (0~10℃)', note: '제조 후 당일포함 3일', isFav: false },
      { id: 'preset-almond-milk', category: '우유·크림', actionType: '개봉', title: '아몬드브리즈 (개봉)', fullName: '아몬드브리즈 (개봉)', days: 5, storage: '냉장 (0~10℃)', note: '개봉 후 당일포함 5일', isFav: false },
      { id: 'preset-oat-milk', category: '우유·크림', actionType: '개봉', title: '오트밀크 (개봉)', fullName: '오트밀크 (개봉)', days: 5, storage: '냉장 (0~10℃)', note: '개봉 후 당일포함 5일', isFav: false },
      { id: 'preset-butterscotch-cream', category: '우유·크림', actionType: '개봉', title: '버터스카치크림 (개봉)', fullName: '버터스카치크림 (개봉)', days: 3, storage: '냉장 (0~10℃)', note: '개봉 후 당일포함 3일', isFav: false },
      { id: 'preset-redvelvet-cream', category: '우유·크림', actionType: '개봉', title: '레드벨벳크림 (개봉)', fullName: '레드벨벳크림 (개봉)', days: 3, storage: '냉장 (0~10℃)', note: '개봉 후 당일포함 3일', isFav: false },

      // --- 3. 시럽 · 소스 · 액상 (소분 내용물별 개별 분리) ---
      { id: 'preset-blueberry-sub', category: '시럽·소스·액상', actionType: '소분', title: '블루베리베이스 (소분)', fullName: '블루베리베이스 (소분)', days: 14, storage: '냉장 (0~10℃)', note: '소분 시 당일포함 14일 (개봉 1개월)', isFav: true },
      { id: 'preset-pineapple-sub', category: '시럽·소스·액상', actionType: '소분', title: '파인애플과육 (소분)', fullName: '파인애플과육 베이스 (소분)', days: 14, storage: '냉장 (0~10℃)', note: '소분 시 당일포함 14일 (개봉 1개월)', isFav: true },
      { id: 'preset-grapefruit-sub', category: '시럽·소스·액상', actionType: '소분', title: '자몽베이스 (소분)', fullName: '자몽베이스 (소분)', days: 14, storage: '냉장 (0~10℃)', note: '소분 시 당일포함 14일', isFav: true },
      { id: 'preset-mango-sub', category: '시럽·소스·액상', actionType: '소분', title: '골드망고베이스 (소분)', fullName: '골드망고베이스 (소분)', days: 14, storage: '냉장 (0~10℃)', note: '소분 시 당일포함 14일', isFav: false },
      { id: 'preset-yuja-sub', category: '시럽·소스·액상', actionType: '소분', title: '유자베이스 (소분)', fullName: '유자베이스 (소분)', days: 14, storage: '냉장 (0~10℃)', note: '소분 시 당일포함 14일', isFav: false },
      { id: 'preset-lemon-base-sub', category: '시럽·소스·액상', actionType: '소분', title: '레몬베이스 (소분)', fullName: '레몬베이스 (소분)', days: 14, storage: '냉장 (0~10℃)', note: '소분 시 당일포함 14일', isFav: false },
      { id: 'preset-greengrape-sub', category: '시럽·소스·액상', actionType: '소분', title: '청포도베이스 (소분)', fullName: '청포도베이스 (소분)', days: 14, storage: '냉장 (0~10℃)', note: '소분 시 당일포함 14일', isFav: false },
      { id: 'preset-strawberry-cheong-sub', category: '시럽·소스·액상', actionType: '소분', title: '딸기청 (소분)', fullName: '딸기청 (소분)', days: 14, storage: '냉장 (0~10℃)', note: '소분 시 당일포함 14일', isFav: true },
      { id: 'preset-choco-sauce-sub', category: '시럽·소스·액상', actionType: '소분', title: '초코소스 (소분)', fullName: '초코소스 (소분)', days: 14, storage: '실온 (1~35℃)', note: '소분 시 당일포함 14일', isFav: true },
      { id: 'preset-caramel-sauce-sub', category: '시럽·소스·액상', actionType: '소분', title: '카라멜소스 (소분)', fullName: '카라멜소스 (소분)', days: 14, storage: '실온 (1~35℃)', note: '소분 시 당일포함 14일', isFav: false },
      { id: 'preset-condensed-milk-sub', category: '시럽·소스·액상', actionType: '소분', title: '연유 (소분)', fullName: '연유 (소분)', days: 7, storage: '냉장 (0~10℃)', note: '소분 시 당일포함 7일 (개봉 1개월)', isFav: true },
      { id: 'preset-sweetpotato-paste', category: '시럽·소스·액상', actionType: '소분', title: '고구마 페이스트 (소분)', fullName: '고구마 페이스트 (소분)', days: 14, storage: '냉장 (0~10℃)', note: '소분 후 당일포함 14일', isFav: false },
      { id: 'preset-pongcrush-sub', category: '시럽·소스·액상', actionType: '소분', title: '퐁크러쉬베이스 (소분)', fullName: '퐁크러쉬베이스 (소분)', days: 5, storage: '냉장 (0~10℃)', note: '소분 시 당일포함 5일 (개봉 14일)', isFav: false },
      { id: 'preset-yogurt-sm-sub', category: '시럽·소스·액상', actionType: '소분', title: '요거트스무디베이스 (소분)', fullName: '요거트스무디베이스 (소분)', days: 5, storage: '냉장 (0~10℃)', note: '소분 시 당일포함 5일', isFav: false },
      { id: 'preset-strawberry-sm-sub', category: '시럽·소스·액상', actionType: '소분', title: '딸기스무디베이스 (소분)', fullName: '딸기스무디베이스 (소분)', days: 5, storage: '냉장 (0~10℃)', note: '소분 시 당일포함 5일', isFav: false },
      { id: 'preset-mango-sm-sub', category: '시럽·소스·액상', actionType: '소분', title: '망고스무디베이스 (소분)', fullName: '망고스무디베이스 (소분)', days: 5, storage: '냉장 (0~10℃)', note: '소분 시 당일포함 5일', isFav: false },
      { id: 'preset-tangerine-jelly', category: '시럽·소스·액상', actionType: '개봉', title: '청귤톡톡젤리 (개봉)', fullName: '청귤톡톡젤리 (개봉)', days: 10, storage: '냉장 (0~10℃)', note: '개봉 후 당일포함 10일', isFav: false },
      { id: 'preset-vanilla-syrup', category: '시럽·소스·액상', actionType: '개봉', title: '바닐라시럽 (개봉)', fullName: '바닐라시럽 (개봉)', days: 30, storage: '실온 (1~35℃)', note: '개봉 후 당일포함 30일', isFav: false },
      { id: 'preset-hazelnut-syrup', category: '시럽·소스·액상', actionType: '개봉', title: '헤이즐넛시럽 (개봉)', fullName: '헤이즐넛시럽 (개봉)', days: 30, storage: '실온 (1~35℃)', note: '개봉 후 당일포함 30일', isFav: false },
      { id: 'preset-honey', category: '시럽·소스·액상', actionType: '개봉', title: '꿀 (개봉)', fullName: '꿀 (개봉)', days: 30, storage: '실온 (1~35℃)', note: '실온보관 당일포함 30일', isFav: false },

      // --- 4. 파우더 & 토핑 (소분 내용물이 모두 다르므로 100% 개별 분리!) ---
      { id: 'preset-natadecoco', category: '파우더·토핑', actionType: '소분', title: '나타드코코 (소분)', fullName: '나타드코코 (소분)', days: 30, storage: '냉장 (0~10℃)', note: '개봉·소분 후 냉장 당일포함 30일', isFav: true },
      { id: 'preset-powder-choco', category: '파우더·토핑', actionType: '소분', title: '초코파우더 (소분)', fullName: '초코파우더 (소분)', days: 30, storage: '실온 (1~35℃)', note: '소분 후 당일포함 30일', isFav: true },
      { id: 'preset-powder-grain', category: '파우더·토핑', actionType: '소분', title: '곡물파우더 (소분)', fullName: '곡물파우더 (소분)', days: 30, storage: '실온 (1~35℃)', note: '소분 후 당일포함 30일', isFav: true },
      { id: 'preset-powder-greentea', category: '파우더·토핑', actionType: '소분', title: '녹차파우더 (소분)', fullName: '녹차파우더 (소분)', days: 30, storage: '실온 (1~35℃)', note: '소분 후 당일포함 30일', isFav: true },
      { id: 'preset-powder-yogurt', category: '파우더·토핑', actionType: '소분', title: '요거트파우더 (소분)', fullName: '요거트파우더 (소분)', days: 30, storage: '실온 (1~35℃)', note: '소분 후 당일포함 30일', isFav: false },
      { id: 'preset-powder-banana', category: '파우더·토핑', actionType: '소분', title: '바나나파우더 (소분)', fullName: '바나나파우더 (소분)', days: 30, storage: '실온 (1~35℃)', note: '소분 후 당일포함 30일', isFav: false },
      { id: 'preset-powder-milktea', category: '파우더·토핑', actionType: '소분', title: '밀크티파우더 (소분)', fullName: '밀크티파우더 (소분)', days: 30, storage: '실온 (1~35℃)', note: '소분 후 당일포함 30일', isFav: false },
      { id: 'preset-powder-cheesecake', category: '파우더·토핑', actionType: '소분', title: '치즈케익파우더 (소분)', fullName: '치즈케익파우더 (소분)', days: 30, storage: '실온 (1~35℃)', note: '소분 후 당일포함 30일', isFav: false },
      { id: 'preset-powder-cookiefrappe', category: '파우더·토핑', actionType: '소분', title: '쿠키프라페파우더 (소분)', fullName: '쿠키프라페파우더 (소분)', days: 30, storage: '실온 (1~35℃)', note: '소분 후 당일포함 30일', isFav: false },
      { id: 'preset-powder-mintchoco', category: '파우더·토핑', actionType: '소분', title: '민트초코파우더 (소분)', fullName: '민트초코파우더 (소분)', days: 30, storage: '실온 (1~35℃)', note: '소분 후 당일포함 30일', isFav: false },
      { id: 'preset-topping-chocochip', category: '파우더·토핑', actionType: '소분', title: '초코칩 (소분)', fullName: '초코칩 토핑 (소분)', days: 7, storage: '실온 (1~35℃)', note: '소분 후 당일포함 7일', isFav: true },
      { id: 'preset-topping-joripong', category: '파우더·토핑', actionType: '소분', title: '조리퐁 (소분)', fullName: '조리퐁 토핑 (소분)', days: 7, storage: '실온 (1~35℃)', note: '소분 후 당일포함 7일', isFav: true },
      { id: 'preset-topping-oreo', category: '파우더·토핑', actionType: '소분', title: '오레오토핑 (소분)', fullName: '오레오 토핑 (소분)', days: 14, storage: '실온 (1~35℃)', note: '소분 후 당일포함 14일', isFav: false },
      { id: 'preset-topping-cookiecrumb', category: '파우더·토핑', actionType: '소분', title: '쿠키크럼 (소분)', fullName: '쿠키크럼 토핑 (소분)', days: 14, storage: '실온 (1~35℃)', note: '소분 후 당일포함 14일', isFav: false },
      { id: 'preset-topping-straw-granola', category: '파우더·토핑', actionType: '소분', title: '딸기그래놀라 (소분)', fullName: '딸기그래놀라 (소분)', days: 14, storage: '실온 (1~35℃)', note: '소분 후 당일포함 14일', isFav: false },
      { id: 'preset-topping-pista-granola', category: '파우더·토핑', actionType: '소분', title: '피스타치오그래놀라 (소분)', fullName: '피스타치오그래놀라 (소분)', days: 14, storage: '실온 (1~35℃)', note: '소분 후 당일포함 14일', isFav: false },
      { id: 'preset-topping-almond', category: '파우더·토핑', actionType: '소분', title: '아몬드슬라이스 (소분)', fullName: '아몬드슬라이스 (소분)', days: 14, storage: '실온 (1~35℃)', note: '소분 후 당일포함 14일', isFav: false },
      { id: 'preset-topping-coconut', category: '파우더·토핑', actionType: '소분', title: '코코넛칩 (소분)', fullName: '코코넛칩 (소분)', days: 14, storage: '실온 (1~35℃)', note: '소분 후 당일포함 14일', isFav: false },
      { id: 'preset-topping-redbean', category: '파우더·토핑', actionType: '소분', title: '팥절임 (소분)', fullName: '팥절임 (소분)', days: 14, storage: '냉장 (0~10℃)', note: '소분 후 당일포함 14일', isFav: false },

      // --- 5. 타피오카펄 · 냉동/생과일 · 커피 (개별 분리) ---
      { id: 'preset-boiled-pearl', category: '펄·과일·커피', actionType: '제조', title: '삶은 타피오카펄 (4H)', fullName: '삶은 타피오카 펄 (제조)', days: 1, hours: 4, storage: '보온 (60~70℃)', note: '제조 후 4시간(4H) 이내 사용', isFav: true },
      { id: 'preset-brownsugar-pearl-sub', category: '펄·과일·커피', actionType: '소분', title: '흑당펄 (소분)', fullName: '흑당펄 (소분)', days: 5, storage: '냉장 (0~10℃)', note: '소분 후 당일포함 5일', isFav: false },
      { id: 'preset-brownsugar-syrup-sub', category: '펄·과일·커피', actionType: '소분', title: '흑당시럽 (소분)', fullName: '흑당시럽 (소분)', days: 5, storage: '실온 (1~35℃)', note: '소분 후 당일포함 5일', isFav: false },
      { id: 'preset-frozen-strawberry', category: '펄·과일·커피', actionType: '해동', title: '냉동딸기 (해동)', fullName: '냉동딸기 (해동)', days: 2, storage: '냉장 (0~10℃)', note: '해동 시작일 포함 2일 (최소 12H 해동)', isFav: true },
      { id: 'preset-frozen-mango', category: '펄·과일·커피', actionType: '해동', title: '냉동망고 (해동)', fullName: '냉동망고 (해동)', days: 3, storage: '냉장 (0~10℃)', note: '해동 시작일 포함 3일 (최소 5H 해동)', isFav: false },
      { id: 'preset-frozen-blueberry', category: '펄·과일·커피', actionType: '해동', title: '냉동블루베리 (해동)', fullName: '냉동블루베리 (해동)', days: 3, storage: '냉장 (0~10℃)', note: '해동 시작일 포함 3일 (최소 5H 해동)', isFav: false },
      { id: 'preset-lemon-slice', category: '펄·과일·커피', actionType: '슬라이스', title: '레몬슬라이스 (소분)', fullName: '레몬 슬라이스 (소분)', days: 3, storage: '냉장 (0~10℃)', note: '슬라이스 후 당일포함 3일', isFav: true },
      { id: 'preset-grapefruit-slice', category: '펄·과일·커피', actionType: '슬라이스', title: '자몽슬라이스 (소분)', fullName: '자몽 슬라이스 (소분)', days: 3, storage: '냉장 (0~10℃)', note: '슬라이스 후 당일포함 3일', isFav: false },
      { id: 'preset-dried-lemon', category: '펄·과일·커피', actionType: '소분', title: '건조레몬슬라이스 (소분)', fullName: '건조레몬슬라이스 (소분)', days: 14, storage: '실온 (1~35℃)', note: '소분 후 당일포함 14일', isFav: false },
      { id: 'preset-greengrape-washed', category: '펄·과일·커피', actionType: '세척후', title: '청포도 (세척 후)', fullName: '청포도 (세척 후)', days: 2, storage: '냉장 (0~10℃)', note: '세척 후 당일포함 2일', isFav: false },
      { id: 'preset-coldbrew-orig', category: '펄·과일·커피', actionType: '개봉', title: '콜드브루 원액 (개봉)', fullName: '콜드브루 원액 (개봉)', days: 14, storage: '냉장 (0~10℃)', note: '개봉 후 당일포함 14일', isFav: false },
      { id: 'preset-coldbrew-diluted', category: '펄·과일·커피', actionType: '제조', title: '콜드브루 배합액 (당일)', fullName: '콜드브루 배합액 (제조)', days: 1, storage: '냉장 (0~10℃)', note: '제조 당일 폐기 (1일)', isFav: false },
      { id: 'preset-espresso-beans', category: '펄·과일·커피', actionType: '개봉', title: '에스프레소 원두 (개봉)', fullName: '에스프레소 원두 (개봉)', days: 7, storage: '실온 (1~35℃)', note: '개봉 후 당일포함 7일', isFav: false },
      { id: 'preset-decaf-beans', category: '펄·과일·커피', actionType: '개봉', title: '디카페인 원두 (개봉)', fullName: '디카페인 원두 (개봉)', days: 7, storage: '실온 (1~35℃)', note: '개봉 후 당일포함 7일', isFav: false },
      { id: 'preset-hopper-beans', category: '펄·과일·커피', actionType: '소분', title: '원두 호퍼 (소분)', fullName: '원두 호퍼 (소분)', days: 2, storage: '실온 (1~35℃)', note: '호퍼 소분 후 당일포함 2일', isFav: false },

      // --- 6. 베이커리 & 케익 해동 (품목별 완전 개별 분리!) ---
      { id: 'preset-cake-cheese', category: '베이커리·케익', actionType: '해동', title: '치즈케익 (해동)', fullName: '치즈케익 (해동)', days: 3, storage: '냉장 (0~10℃)', note: '냉장해동 3H 후 48H(당일포함 3일)', isFav: true },
      { id: 'preset-cake-chocomousse', category: '베이커리·케익', actionType: '해동', title: '초코무스케익 (해동)', fullName: '초코무스케익 (해동)', days: 3, storage: '냉장 (0~10℃)', note: '냉장해동 3H 후 48H(당일포함 3일)', isFav: true },
      { id: 'preset-cake-tiramisu', category: '베이커리·케익', actionType: '해동', title: '티라미수케익 (해동)', fullName: '티라미수케익 (해동)', days: 3, storage: '냉장 (0~10℃)', note: '냉장해동 3H 후 48H(당일포함 3일)', isFav: true },
      { id: 'preset-bread-croque', category: '베이커리·케익', actionType: '해동', title: '크로크무슈 (해동)', fullName: '크로크무슈 (해동)', days: 2, storage: '냉장 (0~10℃)', note: '냉장해동 3H 후 24H(당일포함 2일)', isFav: false },
      { id: 'preset-bread-honeybread', category: '베이커리·케익', actionType: '해동', title: '허니브레드 (해동)', fullName: '허니브레드 (해동)', days: 2, storage: '냉장 (0~10℃)', note: '냉장해동 3H 후 24H(당일포함 2일)', isFav: false },
      { id: 'preset-bread-croffle', category: '베이커리·케익', actionType: '해동', title: '크로플 (해동)', fullName: '크로플 (해동)', days: 2, storage: '냉장 (0~10℃)', note: '냉장해동 3H 후 24H(당일포함 2일)', isFav: false },
      { id: 'preset-bread-saltbread', category: '베이커리·케익', actionType: '해동', title: '버터소금빵 (해동)', fullName: '버터소금빵 (해동)', days: 2, storage: '냉장 (0~10℃)', note: '냉장해동 3H 후 24H(당일포함 2일)', isFav: false },
      { id: 'preset-ciabatta-hamcheese', category: '베이커리·케익', actionType: '해동', title: '햄앤치즈 치아바타 (해동)', fullName: '햄앤치즈 치아바타 (해동)', days: 2, storage: '냉장 (0~10℃)', note: '냉장해동 7H 후 24H(당일포함 2일)', isFav: false },
      { id: 'preset-ciabatta-chipotle', category: '베이커리·케익', actionType: '해동', title: '치폴레치킨 치아바타 (해동)', fullName: '치폴레치킨 치아바타 (해동)', days: 2, storage: '냉장 (0~10℃)', note: '냉장해동 7H 후 24H(당일포함 2일)', isFav: false },
      { id: 'preset-bread-hotdog', category: '베이커리·케익', actionType: '해동', title: '핫도그 (해동)', fullName: '핫도그 (해동)', days: 2, storage: '냉장 (0~10℃)', note: '냉장해동 3H 후 24H(당일포함 2일)', isFav: false }
    ];
  }

  function createDefaultState() {
    const now = new Date();

    const presets = createDefaultPresets();


    // Example inclusive calculation for initial sticker (우유 개봉: 당일포함 3일 -> +2일)
    const milkPreset = presets.find((p) => p.id === 'preset-milk');
    const initCalc = calculateInclusiveExpiry(now, milkPreset);

    return {
      appMode: 'SIMPLE',
      simpleCategory: 'ALL',
      simpleSearchQuery: '',
      receiveCategory: 'ALL',
      receiveSearchQuery: '',
      receiveHistory: [],
      currentStaff: '알바 A (김민지)',
      selectedZone: 'ALL',
      viewMode: 'BY_DAYS',
      ddayFilter: 'ALL',
      selectedPresetCategory: 'ALL',
      presetSearchQuery: '',
      labelSequence: 1,
      roiSavedKrw: 0,
      statsIncludeSample: false,
      demoDataCleared: true,
      presets,
      unopenedProducts: [],
      deliverySlips: [],
      activeTimers: [],
      lastPrintedLabel: {
        presetId: 'preset-milk',
        code: '#L-000',
        actionType: '개봉',
        itemName: '우유 1L (개봉)',
        originalExpiryFormatted: addDaysToDateStr(now, 5).replace(/-/g, '.'),
        openedAtFormatted: initCalc.openedAtFormatted,
        expiresAtFormatted: initCalc.expiresAtFormatted,
        ruleDetailText: initCalc.ruleDetailText,
        manager: '알바 A (김민지)',
        storageMethod: '냉장 (0~10℃)'
      }
    };
  }

  let state = loadState();
  let pendingFifoOverride = null;

  function applyRecommendedFavs(presetsArr) {
    const coreIds = new Set([
      'preset-milk',
      'preset-whip-cream',
      'preset-sugar-base',
      'preset-strawberry-cheong-sub',
      'preset-boiled-pearl',
      'preset-cake-cheese'
    ]);
    let matchedCount = 0;
    presetsArr.forEach((p) => {
      if (coreIds.has(p.id)) {
        p.isFav = true;
        matchedCount += 1;
      } else {
        p.isFav = false;
      }
    });
    if (matchedCount === 0) {
      presetsArr.forEach((p, idx) => {
        p.isFav = idx < 6;
      });
    }
  }

  // 예전 버전이 자동으로 넣어주던 데모 데이터(가짜 재고·타이머·거래명세서·절감금액)를 1회 정리
  function stripLegacyDemoData(s) {
    if (!s || s.demoDataCleared) return s;
    const seededProdIds = new Set(['prod-milk', 'prod-whip', 'prod-fresh-cream', 'prod-blueberry', 'prod-pineapple', 'prod-natadecoco', 'prod-oat-milk', 'prod-almond-milk', 'prod-condensed', 'prod-lemon-slice', 'prod-croque', 'prod-cake-cheese', 'prod-cake-tiramisu']);
    const seededLotIds = new Set(['lot-m1', 'lot-m2', 'lot-c1', 'lot-c2', 'lot-fc1', 'lot-b1', 'lot-b2', 'lot-p1', 'lot-n1', 'lot-o1', 'lot-am1', 'lot-cm1', 'lot-dl1', 'lot-cr1', 'lot-ck1', 'lot-ti1']);
    const seededTimerIds = new Set(['timer-closing-1', 'timer-closing-2', 'timer-active-3']);

    if (Array.isArray(s.receiveHistory)) {
      s.receiveHistory = s.receiveHistory.filter((r) => !String(r.id || '').startsWith('rec-init-'));
    }
    if (Array.isArray(s.deliverySlips)) {
      s.deliverySlips = s.deliverySlips.filter((d) => !String(d.id || '').startsWith('slip-seed-'));
    }
    if (Array.isArray(s.activeTimers)) {
      s.activeTimers = s.activeTimers.filter((t) => !seededTimerIds.has(t.id));
    }
    if (Array.isArray(s.unopenedProducts)) {
      s.unopenedProducts = s.unopenedProducts
        .map((p) => (seededProdIds.has(p.id)
          ? { ...p, lots: (p.lots || []).filter((l) => !seededLotIds.has(l.id)) }
          : p))
        .filter((p) => !(seededProdIds.has(p.id) && (!p.lots || p.lots.length === 0)));
    }
    if (Array.isArray(s.unopenedProducts)) {
      s.unopenedProducts.forEach((p) => {
        if (Array.isArray(p.lots)) {
          p.lots = p.lots.filter((l) => !(String(l.id || '').startsWith('lot-auto-') && Number(l.qty) === 8));
        }
      });
    }
    if (Number(s.roiSavedKrw) >= 485000) {
      s.roiSavedKrw = Number(s.roiSavedKrw) - 485000;
    }
    s.statsIncludeSample = false;
    s.demoDataCleared = true;
    return s;
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const def = createDefaultState();
        applyRecommendedFavs(def.presets);
        def.favInitialized = true;
        def.favCols = 3;
        def.bigFavOnly = false;
        def.currentStaff = '매장관리자';
        def.labelPaperSize = '58x40';
        def.labelLargeFont = false;
        def.labelShowOrigExpiry = true;
        def.labelShowManager = true;
        return def;
      }
      const parsed = JSON.parse(raw);
      if (!parsed.presets || !parsed.unopenedProducts) return createDefaultState();
      stripLegacyDemoData(parsed);
      if (!Array.isArray(parsed.deliverySlips)) parsed.deliverySlips = [];
      if (!parsed.viewMode) parsed.viewMode = 'BY_DAYS';
      if (!parsed.ddayFilter) parsed.ddayFilter = 'ALL';
      if (!parsed.selectedPresetCategory) parsed.selectedPresetCategory = 'ALL';
      if (!parsed.appMode) parsed.appMode = 'SIMPLE';
      if (!parsed.simpleCategory) parsed.simpleCategory = 'ALL';
      if (typeof parsed.simpleSearchQuery !== 'string') parsed.simpleSearchQuery = '';
      if (!parsed.receiveCategory) parsed.receiveCategory = 'ALL';
      if (typeof parsed.receiveSearchQuery !== 'string') parsed.receiveSearchQuery = '';
      if (!Array.isArray(parsed.receiveHistory)) parsed.receiveHistory = [];
      if (!parsed.useCategory) parsed.useCategory = 'ALL';
      if (typeof parsed.useSearchQuery !== 'string') parsed.useSearchQuery = '';
      if (!Array.isArray(parsed.useHistory)) parsed.useHistory = [];
      if (!parsed.favInitialized) {
        applyRecommendedFavs(parsed.presets);
        parsed.favInitialized = true;
      }
      if (!parsed.favCols) parsed.favCols = 3;
      if (typeof parsed.bigFavOnly !== 'boolean') parsed.bigFavOnly = false;
      if (typeof parsed.useBigFavOnly !== 'boolean') parsed.useBigFavOnly = false;
      if (typeof parsed.alertBarCollapsed !== 'boolean') parsed.alertBarCollapsed = false;
      if (typeof parsed.googleSheetWebAppUrl !== 'string') parsed.googleSheetWebAppUrl = '';
      if (typeof parsed.googleAutoSync !== 'boolean') parsed.googleAutoSync = true;
      if (typeof parsed.lastSyncUpdatedAt !== 'number') parsed.lastSyncUpdatedAt = 0;
      if (typeof parsed.lastSyncTimeStr !== 'string') parsed.lastSyncTimeStr = '';
      if (parsed.licenseTier !== 'FULL' && parsed.licenseTier !== 'TRIAL') parsed.licenseTier = 'TRIAL';
      if (typeof parsed.licenseKey !== 'string') parsed.licenseKey = '';
      if (parsed.licenseTier === 'TRIAL') parsed.appMode = 'SIMPLE';
      if (!parsed.statsPeriod) parsed.statsPeriod = 'DAILY';
      if (!parsed.statsCategory) parsed.statsCategory = 'ALL';
      if (!parsed.statsItemId) parsed.statsItemId = 'ALL';
      if (typeof parsed.statsIncludeSample !== 'boolean') parsed.statsIncludeSample = false;
      if (typeof parsed.currentStaff !== 'string' || !parsed.currentStaff.trim() || parsed.currentStaff.startsWith('알바')) {
        parsed.currentStaff = '매장관리자';
      }
      if (!parsed.labelPaperSize) parsed.labelPaperSize = '58x40';
      if (typeof parsed.labelLargeFont !== 'boolean') parsed.labelLargeFont = false;
      if (typeof parsed.labelShowOrigExpiry !== 'boolean') parsed.labelShowOrigExpiry = true;
      if (typeof parsed.labelShowManager !== 'boolean') parsed.labelShowManager = true;
      return parsed;
    } catch (_) {
      return createDefaultState();
    }
  }

  let googlePushDebounceTimer = null;
  let isGoogleSyncInFlight = false;

  function saveState(skipCloudPush = false) {
    try {
      if (!skipCloudPush) {
        state.lastSyncUpdatedAt = Date.now();
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (!skipCloudPush && state.googleSheetWebAppUrl && state.googleAutoSync) {
        if (googlePushDebounceTimer) clearTimeout(googlePushDebounceTimer);
        googlePushDebounceTimer = setTimeout(() => {
          googlePushDebounceTimer = null;
          pushStateToGoogleSheet(true);
        }, 350);
      }
    } catch (_) {}
  }

  function getGoogleAppsScriptTemplateCode() {
    return [
      '// ============================================================================',
      '// FreshLabel x 내 구글 스프레드시트 실시간 자동 연동 스크립트 (서버비 평생 0원)',
      '// [사용법] 상단 [배포] -> [새 배포] -> 유형: [웹 앱] -> 액세스 권한: [모든 사용자] 배포 후 URL 복사',
      '// ============================================================================',
      '',
      'function doGet(e) {',
      '  var ss = SpreadsheetApp.getActiveSpreadsheet();',
      '  var dbSheet = ss.getSheetByName("FreshLabel_DB");',
      '  if (!dbSheet) {',
      '    return ContentService.createTextOutput(JSON.stringify({ ok: true, empty: true }))',
      '      .setMimeType(ContentService.MimeType.JSON);',
      '  }',
      '  var rawJson = dbSheet.getRange("A2").getValue();',
      '  var updatedAt = Number(dbSheet.getRange("B2").getValue() || 0);',
      '  return ContentService.createTextOutput(JSON.stringify({',
      '    ok: true,',
      '    updatedAt: updatedAt,',
      '    payloadJson: rawJson',
      '  })).setMimeType(ContentService.MimeType.JSON);',
      '}',
      '',
      'function doPost(e) {',
      '  try {',
      '    var body = JSON.parse(e.postData.contents || "{}");',
      '    var payload = body.payload || {};',
      '    var updatedAt = Number(body.updatedAt || Date.now());',
      '    var ss = SpreadsheetApp.getActiveSpreadsheet();',
      '',
      '    // 1. 원본 동기화 데이터 시트 저장',
      '    var dbSheet = ss.getSheetByName("FreshLabel_DB") || ss.insertSheet("FreshLabel_DB");',
      '    dbSheet.getRange("A1:C1").setValues([["STATE_JSON", "UPDATED_AT_MS", "UPDATED_TIME_KR"]]).setFontWeight("bold");',
      '    dbSheet.getRange("A2:C2").setValues([[JSON.stringify(payload), updatedAt, new Date().toLocaleString("ko-KR")]]);',
      '',
      '    // 2. [1_실시간재고현황] 엑셀 시트 자동 정리',
      '    var stockSheet = ss.getSheetByName("1_실시간재고현황") || ss.insertSheet("1_실시간재고현황");',
      '    stockSheet.clearContents();',
      '    var stockRows = [["품목명", "보관구역", "총 재고수량", "단위", "선입선출 1순위 유통기한", "로트별 상세(유통기한:수량)"]];',
      '    var prods = payload.unopenedProducts || [];',
      '    for (var i = 0; i < prods.length; i++) {',
      '      var p = prods[i];',
      '      var activeLots = (p.lots || []).filter(function(l) { return Number(l.qty) > 0; }).sort(function(a, b) {',
      '        return String(a.expiryDate).localeCompare(String(b.expiryDate));',
      '      });',
      '      var totalQty = activeLots.reduce(function(acc, l) { return acc + Number(l.qty || 0); }, 0);',
      '      var firstExp = activeLots.length > 0 ? activeLots[0].expiryDate : "-";',
      '      var lotSummary = activeLots.map(function(l) { return l.expiryDate + "(" + l.qty + (p.unit || "개") + ")"; }).join(", ");',
      '      stockRows.push([p.name || "", p.zone || "", totalQty, p.unit || "개", firstExp, lotSummary || "재고 없음"]);',
      '    }',
      '    stockSheet.getRange(1, 1, stockRows.length, 6).setValues(stockRows);',
      '    stockSheet.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#D1FAE5");',
      '',
      '    // 3. [2_마감폐기타이머] 엑셀 시트 자동 정리',
      '    var timerSheet = ss.getSheetByName("2_마감폐기타이머") || ss.insertSheet("2_마감폐기타이머");',
      '    timerSheet.clearContents();',
      '    var timerRows = [["라벨코드", "품목명", "개봉·제조일시", "소비기한(만료일)", "보관방법", "담당자"]];',
      '    var timers = payload.activeTimers || [];',
      '    for (var j = 0; j < timers.length; j++) {',
      '      var t = timers[j];',
      '      timerRows.push([t.code || "", t.itemName || "", t.openedAtFormatted || "", t.expiresAtFormatted || "", t.storageMethod || "", t.manager || ""]);',
      '    }',
      '    timerSheet.getRange(1, 1, timerRows.length, 6).setValues(timerRows);',
      '    timerSheet.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#FEE2E2");',
      '',
      '    // 4. [3_입출고내역] 엑셀 시트 자동 정리',
      '    var histSheet = ss.getSheetByName("3_입출고내역") || ss.insertSheet("3_입출고내역");',
      '    histSheet.clearContents();',
      '    var histRows = [["구분", "일시", "품목명", "수량", "단위", "비고(유통기한/남은재고)"]];',
      '    var uses = payload.useHistory || [];',
      '    for (var u = 0; u < Math.min(uses.length, 100); u++) {',
      '      var uh = uses[u];',
      '      histRows.push(["사용차감(-)", uh.timeStr || "", uh.itemName || "", -Number(uh.qty || 1), uh.unit || "", "남은재고: " + (uh.remainingQty ?? "-")]);',
      '    }',
      '    var recs = payload.receiveHistory || [];',
      '    for (var r = 0; r < Math.min(recs.length, 100); r++) {',
      '      var rh = recs[r];',
      '      histRows.push(["입고(+)", rh.timeStr || "", rh.itemName || "", "+" + Number(rh.qty || 1), rh.unit || "", "유통기한: " + (rh.expiryDate || "-")]);',
      '    }',
      '    histSheet.getRange(1, 1, histRows.length, 6).setValues(histRows);',
      '    histSheet.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#E0F2FE");',
      '',
      '    return ContentService.createTextOutput(JSON.stringify({ ok: true, updatedAt: updatedAt }))',
      '      .setMimeType(ContentService.MimeType.JSON);',
      '  } catch (err) {',
      '    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))',
      '      .setMimeType(ContentService.MimeType.JSON);',
      '  }',
      '}'
    ].join('\n');
  }

  function buildLightweightCloudPayload() {
    const strippedProducts = (state.unopenedProducts || []).map((prod) => ({
      id: prod.id,
      name: prod.name,
      unit: prod.unit,
      zone: prod.zone,
      linkedPresetId: prod.linkedPresetId,
      lots: prod.lots || []
    }));

    return {
      brandTemplate: state.brandTemplate,
      brandName: state.brandName,
      currentStaff: state.currentStaff,
      labelSequence: state.labelSequence,
      roiSavedKrw: state.roiSavedKrw,
      presets: state.presets,
      unopenedProducts: strippedProducts,
      activeTimers: state.activeTimers || [],
      lastPrintedLabel: state.lastPrintedLabel,
      receiveHistory: (state.receiveHistory || []).slice(0, 60),
      useHistory: (state.useHistory || []).slice(0, 60),
      favCols: state.favCols || 3
    };
  }

  function applyCloudPayloadToState(payload, remoteUpdatedAt) {
    if (!payload || !Array.isArray(payload.presets) || !Array.isArray(payload.unopenedProducts)) {
      return false;
    }
    const existingPhotosById = new Map();
    (state.unopenedProducts || []).forEach((p) => {
      if (p.photoUrl) existingPhotosById.set(p.id, p.photoUrl);
    });

    state.brandTemplate = payload.brandTemplate || state.brandTemplate;
    state.brandName = payload.brandName || state.brandName;
    state.currentStaff = payload.currentStaff || state.currentStaff;
    state.labelSequence = Number(payload.labelSequence || state.labelSequence);
    state.roiSavedKrw = Number(payload.roiSavedKrw ?? state.roiSavedKrw);
    state.presets = payload.presets;
    state.unopenedProducts = payload.unopenedProducts.map((p) => ({
      ...p,
      photoUrl: existingPhotosById.get(p.id) || generateProductPhotoDataUrl(p.name, p.zone || '냉장', '#059669', (p.lots && p.lots[0] && p.lots[0].expiryDate) || '2026-12-31')
    }));
    state.activeTimers = Array.isArray(payload.activeTimers) ? payload.activeTimers : [];
    if (payload.lastPrintedLabel) state.lastPrintedLabel = payload.lastPrintedLabel;
    if (Array.isArray(payload.receiveHistory)) state.receiveHistory = payload.receiveHistory;
    if (Array.isArray(payload.useHistory)) state.useHistory = payload.useHistory;
    if (payload.favCols) state.favCols = payload.favCols;

    if (!state.demoDataCleared) stripLegacyDemoData(state);
    else {
      // 클라우드(구글 시트)에 남아 있던 예전 데모 데이터도 제거
      const keepFlag = state.demoDataCleared;
      state.demoDataCleared = false;
      stripLegacyDemoData(state);
      state.demoDataCleared = keepFlag;
    }
    state.lastSyncUpdatedAt = Number(remoteUpdatedAt || Date.now());
    state.lastSyncTimeStr = formatDateTime(new Date());
    saveState(true);
    renderAll();
    renderCurrentSticker();
    return true;
  }

  function renderGoogleSyncStatus(customMessage = '') {
    const headerBtn = document.getElementById('btnOpenGoogleSyncModal');
    const headerLabel = document.getElementById('googleSyncHeaderLabel');
    const statusCard = document.getElementById('googleSyncStatusCard');
    const statusTitle = document.getElementById('googleSyncStatusTitle');
    const statusSub = document.getElementById('googleSyncStatusSub');
    const urlInput = document.getElementById('googleSheetWebAppUrlInput');
    const autoSyncChk = document.getElementById('chkGoogleAutoSync');

    const isConnected = Boolean(state.googleSheetWebAppUrl && state.googleSheetWebAppUrl.startsWith('http'));

    if (headerBtn) {
      headerBtn.classList.toggle('is-synced', isConnected);
    }
    if (headerLabel) {
      headerLabel.textContent = isConnected ? '● 구글 연동됨' : '구글 연동';
    }
    if (statusCard) {
      statusCard.classList.toggle('connected', isConnected);
    }
    if (urlInput && document.activeElement !== urlInput) {
      urlInput.value = state.googleSheetWebAppUrl || '';
    }
    if (autoSyncChk) {
      autoSyncChk.checked = Boolean(state.googleAutoSync);
    }

    if (statusTitle && statusSub) {
      if (isConnected) {
        statusTitle.textContent = '✓ 내 구글 스프레드시트 실시간 연동 중 (서버비 0원)';
        statusSub.textContent =
          customMessage ||
          (state.lastSyncTimeStr
            ? `마지막 동기화: ${state.lastSyncTimeStr} · 다른 핸드폰에서도 같은 연동 주소로 실시간 확인 가능`
            : `연결 완료 · 재고 변경 시 내 구글 시트에 자동 저장됩니다.`);
      } else {
        statusTitle.textContent = '현재 기기 단독 저장 모드 (구글 시트 미연결)';
        statusSub.textContent =
          customMessage ||
          '아래에 내 구글 스프레드시트 연동 주소를 입력하면 다른 핸드폰에서도 실시간으로 재고를 확인할 수 있습니다.';
      }
    }
  }

  async function pushStateToGoogleSheet(silent = false) {
    const url = (state.googleSheetWebAppUrl || '').trim();
    if (!url || isGoogleSyncInFlight) return;
    isGoogleSyncInFlight = true;
    if (!silent) {
      renderGoogleSyncStatus('☁️ 내 구글 스프레드시트에 데이터를 저장하는 중...');
    }
    try {
      const updatedAt = Date.now();
      state.lastSyncUpdatedAt = updatedAt;
      const bodyStr = JSON.stringify({
        updatedAt,
        payload: buildLightweightCloudPayload()
      });

      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: bodyStr
      });

      state.lastSyncTimeStr = formatDateTime(new Date());
      saveState(true);
      renderGoogleSyncStatus(`✓ 구글 스프레드시트 저장 완료 (${state.lastSyncTimeStr})`);
    } catch (err) {
      if (!silent) {
        renderGoogleSyncStatus(`⚠️ 구글 시트 저장 실패: 인터넷 연결 또는 웹 앱 URL을 확인해 주세요.`);
      }
    } finally {
      isGoogleSyncInFlight = false;
    }
  }

  async function pullStateFromGoogleSheet(silent = false) {
    const url = (state.googleSheetWebAppUrl || '').trim();
    if (!url || isGoogleSyncInFlight) return;
    isGoogleSyncInFlight = true;
    if (!silent) {
      renderGoogleSyncStatus('🔄 내 구글 스프레드시트에서 최신 재고 현황을 불러오는 중...');
    }
    try {
      const sep = url.includes('?') ? '&' : '?';
      const res = await fetch(`${url}${sep}t=${Date.now()}`, {
        method: 'GET',
        redirect: 'follow'
      });
      const data = await res.json();
      if (data && data.ok && data.payloadJson) {
        const remoteUpdatedAt = Number(data.updatedAt || 0);
        if (!silent || remoteUpdatedAt > (state.lastSyncUpdatedAt || 0)) {
          const parsedPayload = typeof data.payloadJson === 'string' ? JSON.parse(data.payloadJson) : data.payloadJson;
          applyCloudPayloadToState(parsedPayload, remoteUpdatedAt);
          renderGoogleSyncStatus(`✓ 구글 시트에서 최신 상태를 불러왔습니다 (${state.lastSyncTimeStr})`);
        } else {
          renderGoogleSyncStatus();
        }
      } else if (data && data.empty) {
        if (!silent) {
          await pushStateToGoogleSheet(false);
        }
      }
    } catch (err) {
      if (!silent) {
        renderGoogleSyncStatus('⚠️ 불러오기 실패: Apps Script 배포 시 액세스 권한을 [모든 사용자]로 설정했는지 확인해 주세요.');
      }
    } finally {
      isGoogleSyncInFlight = false;
    }
  }

  // ==========================================================================
  // Trial vs 30,000 KRW Lifetime Full Version License System
  // (Google Sheet Checkpoint Server: Max 3 Devices Limit + Remote Block + Obfuscated Signature)
  // ==========================================================================
  const DEFAULT_SELLER_PURCHASE_URL = 'https://open.kakao.com/';
  const DEFAULT_LICENSE_CHECKPOINT_URL = 'https://script.google.com/macros/s/AKfycbz7AP1h8gLSMjoFewdvXIIY9fBJBFTZDSAV_IMOJx7l72TrKWAnHOs8Fc_JJG6ifnNL/exec'; // 판매자 전용 구글 시트 검문소 웹앱 URL
  const DEVICE_ID_STORAGE_KEY = 'freshlabel_unique_device_id_v1';
  const CHECKPOINT_URL_STORAGE_KEY = 'freshlabel_license_checkpoint_url_v1';

  // 무료 체험판에서 바로 출력 테스트 가능한 대표 샘플 6종 (분류별 핵심 품목)
  const TRIAL_ALLOWED_PRESET_IDS = new Set([
    'preset-milk',                 // 1. 우유·크림: 우유 1L (개봉 3일)
    'preset-whip-cream',           // 2. 우유·크림: 일반 휘핑크림 (제조 3일)
    'preset-sugar-base',           // 3. 물베이스: 설탕베이스 (제조 5일)
    'preset-strawberry-cheong-sub',// 4. 시럽·소스·액상: 딸기청 (소분 14일)
    'preset-boiled-pearl',         // 5. 펄·과일·커피: 삶은 타피오카펄 (4시간 타이머)
    'preset-cake-cheese'           // 6. 베이커리·케익: 치즈케익 (해동 3일)
  ]);

  function getOrCreateDeviceId() {
    try {
      let devId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (!devId) {
        const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
        const ts = Date.now().toString(36).slice(-5).toUpperCase();
        devId = `DEV-${ts}-${rand}`;
        localStorage.setItem(DEVICE_ID_STORAGE_KEY, devId);
      }
      return devId;
    } catch (_) {
      return 'DEV-LOCAL-01';
    }
  }

  function getDeviceSummaryLabel() {
    const ua = navigator.userAgent || '';
    if (/iPad|Tablet/i.test(ua)) return '태블릿';
    if (/iPhone|Android|Mobile/i.test(ua)) return '스마트폰';
    return 'PC/포스기';
  }

  function getActiveCheckpointUrl() {
    try {
      const saved = (localStorage.getItem(CHECKPOINT_URL_STORAGE_KEY) || '').trim();
      if (saved && saved.startsWith('http')) return saved;
    } catch (_) {}
    return DEFAULT_LICENSE_CHECKPOINT_URL;
  }

  function isFullLicense() {
    return state.licenseTier === 'FULL';
  }

  function isPresetUnlockedInTrial(preset) {
    if (isFullLicense()) return true;
    if (!preset) return false;
    if (TRIAL_ALLOWED_PRESET_IDS.has(preset.id)) return true;
    const hasAnyCorePreset = state.presets.some((p) => TRIAL_ALLOWED_PRESET_IDS.has(p.id));
    if (hasAnyCorePreset) return false;
    const idx = state.presets.findIndex((p) => p.id === preset.id);
    return idx >= 0 && idx < 6;
  }

  // Obfuscated multi-round signature check (F12 평문 노출 방지용 바이트 배열 연산)
  function _vSig(tStr) {
    const c = String(tStr || '\x53\x54\x4F\x52\x45').trim().toUpperCase().replace(/[^A-Z0-9가-힣]/g, '') || '\x53\x54\x4F\x52\x45';
    const _k = [70, 76, 51, 48, 95, 76, 73, 70, 69, 84, 73, 77, 69, 95, 51, 48, 48, 48, 48, 95];
    const _s = [95, 50, 48, 50, 54];
    const p = _k.map((x) => String.fromCharCode(x)).join('') + c + _s.map((x) => String.fromCharCode(x)).join('');
    let h = (0x1505 ^ 0x00) >>> 0;
    for (let i = 0; i < p.length; i += 1) {
      h = (Math.imul(h, 33) ^ p.charCodeAt(i)) >>> 0;
    }
    return Math.abs(h >>> 0).toString(16).toUpperCase().slice(0, 4).padStart(4, '0');
  }

  function verifyLicenseKey(rawKey) {
    const k = String(rawKey || '').trim().toUpperCase();
    if (!k) return false;
    const parts = k.split('-');
    if (parts.length !== 3 || parts[0] !== 'FL30') return false;
    const tag = parts[1];
    const code = parts[2];
    if (!tag || !code) return false;
    return _vSig(tag) === code.slice(0, 4);
  }

  function extractDeviceIdToken(devEntry) {
    return String(devEntry || '').trim().split(/\s+/)[0].toUpperCase();
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseCheckpointRowData(remote) {
    const rawStatus = String(remote.status || 'ACTIVE').trim();
    const isBlocked = rawStatus.toUpperCase().startsWith('BLOCKED');
    let maxDevices = Number(remote.maxDevices || 3);
    const maxMatch = rawStatus.match(/최대(\d+)대/);
    if (maxMatch) {
      maxDevices = Math.max(1, Number(maxMatch[1]) || 3);
    }
    let devices = Array.isArray(remote.devices) ? remote.devices.map(String).filter(Boolean) : [];
    const devSplitIdx = rawStatus.indexOf('||');
    if (devSplitIdx !== -1) {
      try {
        const parsedDevs = JSON.parse(rawStatus.slice(devSplitIdx + 2));
        if (Array.isArray(parsedDevs)) {
          devices = parsedDevs.map(String).filter(Boolean);
        }
      } catch (_) {}
    }
    return {
      dateDisplay: String(remote.dateDisplay || ''),
      storeName: String(remote.storeName || '매장'),
      key: String(remote.key || '').trim().toUpperCase(),
      status: isBlocked ? 'BLOCKED' : 'ACTIVE',
      maxDevices,
      devices,
      usedDevices: devices.length,
      contact: String(remote.contact || ''),
      channel: String(remote.channel || ''),
      price: Number(remote.price || 30000),
      memo: String(remote.memo || '')
    };
  }

  async function fetchCheckpointRecordForKey(rawKey) {
    const entered = String(rawKey || '').trim().toUpperCase();
    const checkpointUrl = getActiveCheckpointUrl();
    if (!entered || !checkpointUrl) return null;
    try {
      const res = await fetch(`${checkpointUrl}${checkpointUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`);
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.list)) {
        const found = data.list.find((r) => String(r.key || '').trim().toUpperCase() === entered);
        if (found) return parseCheckpointRowData(found);
        return {
          exists: false,
          key: entered,
          storeName: entered.split('-')[1] || '매장',
          status: 'ACTIVE',
          maxDevices: 3,
          devices: [],
          usedDevices: 0
        };
      }
    } catch (_) {}
    return null;
  }

  let _deviceWriteInFlight = 0;
  async function saveCheckpointRecordState(key, nextState) {
    _deviceWriteInFlight += 1;
    try {
      return await _saveCheckpointRecordStateInner(key, nextState);
    } finally {
      setTimeout(() => {
        _deviceWriteInFlight = Math.max(0, _deviceWriteInFlight - 1);
      }, 2500);
    }
  }

  async function _saveCheckpointRecordStateInner(key, nextState) {
    const checkpointUrl = getActiveCheckpointUrl();
    if (!checkpointUrl || !key) return false;
    const cleanKey = String(key).trim().toUpperCase();
    const maxDev = Math.max(1, Number(nextState.maxDevices || 3));
    const devs = Array.isArray(nextState.devices) ? nextState.devices.map(String).filter(Boolean) : [];
    const isBlocked = nextState.status === 'BLOCKED';

    try {
      const postCmd = (bodyObj) =>
        fetch(checkpointUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(bodyObj)
        }).then((r) => r.json()).catch(() => null);

      await postCmd({
        action: 'issueLicense',
        dateDisplay: nextState.dateDisplay || new Date().toLocaleString(),
        storeName: nextState.storeName || cleanKey.split('-')[1] || '매장',
        key: cleanKey,
        contact: nextState.contact || '',
        channel: nextState.channel || '자동등록',
        price: nextState.price || 30000,
        memo: nextState.memo || ''
      });

      await postCmd({ action: 'resetDevices', key: cleanKey });
      const sheetDevs = devs.slice(0, 3);
      for (const d of sheetDevs) {
        await postCmd({ action: 'verifyLicense', key: cleanKey, deviceId: d });
      }

      const encodedStatus = isBlocked
        ? 'BLOCKED'
        : `ACTIVE (최대${maxDev}대)||${JSON.stringify(devs)}`;

      await postCmd({
        action: 'setStatus',
        key: cleanKey,
        storeName: nextState.storeName || cleanKey.split('-')[1] || '매장',
        status: encodedStatus
      });

      // 동일 PC 로컬 판매자 장부에도 즉시 동기화
      try {
        const rawLedger = localStorage.getItem('freshlabel_seller_admin_ledger_v1');
        if (rawLedger) {
          const list = JSON.parse(rawLedger);
          if (Array.isArray(list)) {
            const item = list.find((x) => String(x.key || '').trim().toUpperCase() === cleanKey);
            if (item) {
              item.status = isBlocked ? 'BLOCKED' : 'ACTIVE';
              item.maxDevices = maxDev;
              item.devices = devs;
              item.usedDevices = devs.length;
              localStorage.setItem('freshlabel_seller_admin_ledger_v1', JSON.stringify(list));
            }
          }
        }
      } catch (_) {}

      return true;
    } catch (_) {
      return false;
    }
  }

  function getLocalSellerLedgerItem(enteredKey) {
    try {
      const raw = localStorage.getItem('freshlabel_seller_admin_ledger_v1');
      if (!raw) return null;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return null;
      return list.find((item) => String(item.key || '').trim().toUpperCase() === enteredKey) || null;
    } catch (_) {
      return null;
    }
  }

  function isKeyBlockedInLocalSellerLedger(enteredKey) {
    const found = getLocalSellerLedgerItem(enteredKey);
    return Boolean(found && found.status === 'BLOCKED');
  }

  async function verifyLicenseWithCheckpointServer(rawKey, silentCheck = false) {
    const entered = String(rawKey || '').trim().toUpperCase();
    if (!verifyLicenseKey(entered)) {
      return {
        ok: false,
        message: '⚠️ 유효하지 않은 인증코드입니다. 오타가 없는지 확인해 주세요.'
      };
    }

    // 1. 동일 브라우저 판매자 장부에서 차단(BLOCKED) 상태인지 즉시 확인
    if (isKeyBlockedInLocalSellerLedger(entered)) {
      return {
        ok: false,
        blockedOrExceeded: true,
        message: '⛔ 판매자에 의해 사용 정지(차단)된 인증코드입니다. 정식판 사용이 제한됩니다.'
      };
    }

    const checkpointUrl = getActiveCheckpointUrl();
    if (!checkpointUrl) {
      return {
        ok: true,
        usedDevices: 1,
        maxDevices: 3,
        message: '🎉 정식판(평생 소장권) 인증이 완료되었습니다! 모든 기능이 잠금 해제되었습니다.'
      };
    }

    try {
      const myDevId = getOrCreateDeviceId();
      const myDevLabel = `${myDevId} (${getDeviceSummaryLabel()})`;
      const record = await fetchCheckpointRecordForKey(entered);

      if (record) {
        if (record.status === 'BLOCKED') {
          return {
            ok: false,
            blockedOrExceeded: true,
            message: '⛔ 판매자에 의해 사용 정지(환불 또는 부정공유 차단)된 인증코드입니다.'
          };
        }

        const localItem = getLocalSellerLedgerItem(entered);
        const maxDev = localItem && localItem.maxDevices ? Number(localItem.maxDevices) : record.maxDevices;
        const devs = Array.isArray(record.devices) ? [...record.devices] : [];
        const existingIdx = devs.findIndex((d) => extractDeviceIdToken(d) === myDevId);

        if (existingIdx === -1) {
          if (devs.length >= maxDev) {
            return {
              ok: false,
              blockedOrExceeded: true,
              usedDevices: devs.length,
              maxDevices: maxDev,
              devices: devs,
              message: `⛔ 허용된 최대 기기 대수(${maxDev}대)를 초과하여 차단되었습니다! 아래 [우리 매장 등록 기기 관리]에서 안 쓰는 기기를 삭제하거나 판매자에게 기기 추가를 요청해 주세요.`
            };
          }
          devs.push(myDevLabel);
          await saveCheckpointRecordState(entered, {
            ...record,
            maxDevices: maxDev,
            devices: devs,
            status: 'ACTIVE'
          });
        }

        return {
          ok: true,
          usedDevices: devs.length,
          maxDevices: maxDev,
          devices: devs,
          message: `🎉 정식판 정품 인증 완료! (등록 기기: ${devs.length}/${maxDev}대)`
        };
      }

      return {
        ok: true,
        usedDevices: 1,
        maxDevices: 3,
        message: '🎉 정식판(평생 소장권) 인증이 완료되었습니다!'
      };
    } catch (_err) {
      if (silentCheck) {
        return { ok: true };
      }
      return {
        ok: true,
        usedDevices: 1,
        maxDevices: 3,
        message: '🎉 정식판(평생 소장권) 인증이 완료되었습니다!'
      };
    }
  }

  let _isCheckingLicenseBlock = false;
  async function checkAndEnforceLicenseBlock() {
    if (!isFullLicense() || !state.licenseKey || _isCheckingLicenseBlock || _deviceWriteInFlight > 0) return;
    _isCheckingLicenseBlock = true;
    try {
      const entered = String(state.licenseKey || '').trim().toUpperCase();
      if (isKeyBlockedInLocalSellerLedger(entered)) {
        enforceImmediateTrialLock('⛔ 판매자에 의해 사용 정지(차단)된 인증코드입니다. 정식판 사용이 제한됩니다.');
        return;
      }
      const record = await fetchCheckpointRecordForKey(entered);
      if (!record) return;

      if (record.status === 'BLOCKED') {
        enforceImmediateTrialLock('⛔ 판매자에 의해 사용 정지(환불 또는 부정공유 차단)된 인증코드입니다.');
        return;
      }

      // 관리자가 [기기초기화]를 눌렀거나 이 기기가 등록 목록에서 삭제된 경우 즉시 체험판으로 전환 (자동 재등록 방지!)
      if (record.exists !== false) {
        const myDevId = getOrCreateDeviceId();
        const stillRegistered = record.devices.some((d) => extractDeviceIdToken(d) === myDevId);
        if (!stillRegistered) {
          enforceImmediateTrialLock('🔄 기기 등록이 초기화되었거나 현재 기기가 등록 해제되어 무료 체험판으로 전환되었습니다. 다시 사용하시려면 [정식판 잠금 해제]를 눌러주세요.');
          return;
        }
      }
    } finally {
      _isCheckingLicenseBlock = false;
    }
  }

  const RELEASED_KEY_STORAGE = 'freshlabel_released_license_key_v1';
  function markLicenseKeyReleased(key) {
    try {
      const k = String(key || '').trim().toUpperCase();
      if (k) localStorage.setItem(RELEASED_KEY_STORAGE, k);
    } catch (_) {}
  }
  function clearLicenseKeyReleased() {
    try { localStorage.removeItem(RELEASED_KEY_STORAGE); } catch (_) {}
  }
  function isLicenseKeyReleased(key) {
    try {
      return localStorage.getItem(RELEASED_KEY_STORAGE) === String(key || '').trim().toUpperCase();
    } catch (_) { return false; }
  }

  function enforceImmediateTrialLock(reasonMessage) {
    markLicenseKeyReleased(state.licenseKey);
    state.licenseTier = 'TRIAL';
    state.appMode = 'SIMPLE';
    saveState();
    renderAll();
    const fbEl = document.getElementById('licenseActivateFeedback');
    if (fbEl) {
      fbEl.style.color = '#B91C1C';
      fbEl.textContent = reasonMessage;
    }
    openLicenseModal(reasonMessage);
    refreshCustomerDeviceManagerUI();
  }

  let _lastDeviceUiSignature = '';
  async function refreshCustomerDeviceManagerUI(silent = false) {
    const countBadge = document.getElementById('customerDeviceCountBadge');
    const listEl = document.getElementById('customerRegisteredDevicesList');
    const keyInput = document.getElementById('licenseKeyInput');
    if (!listEl || !countBadge) return;

    const targetKey = String((keyInput && keyInput.value) || state.licenseKey || '').trim().toUpperCase();
    if (!targetKey || !verifyLicenseKey(targetKey)) {
      countBadge.textContent = '등록 기기: 0 / 3대';
      _lastDeviceUiSignature = '';
      listEl.innerHTML = `
        <div style="font-size: 0.78rem; color: #64748B; font-weight: 700; padding: 8px 10px; background: #FFFFFF; border-radius: 8px; border: 1px dashed #CBD5E1;">
          위에 정식판 인증코드를 입력하면 현재 등록된 매장 기기 현황과 기기 추가/삭제 버튼이 표시됩니다.
        </div>
      `;
      return;
    }

    if (!silent) {
      _lastDeviceUiSignature = '';
      listEl.innerHTML = `<div style="font-size: 0.78rem; color: #2563EB; font-weight: 700; padding: 8px 10px;">🔄 등록된 기기 목록을 불러오는 중...</div>`;
    }
    const record = await fetchCheckpointRecordForKey(targetKey);
    if (!record) {
      if (!silent) {
        listEl.innerHTML = `<div style="font-size: 0.78rem; color: #64748B; font-weight: 700; padding: 8px 10px;">기기 서버에 연결할 수 없습니다.</div>`;
      }
      return;
    }

    // 실시간 자동 갱신 시 데이터가 그대로면 화면을 다시 그리지 않음 (깜빡임 방지)
    const signature = JSON.stringify([targetKey, record.status, record.maxDevices, record.devices]);
    if (silent && signature === _lastDeviceUiSignature) return;
    _lastDeviceUiSignature = signature;

    const myDevId = getOrCreateDeviceId();
    const maxDev = record.maxDevices || 3;
    const devs = Array.isArray(record.devices) ? record.devices : [];
    countBadge.textContent = `등록 기기: ${devs.length} / ${maxDev}대 (여유 ${Math.max(0, maxDev - devs.length)}대)`;
    countBadge.style.backgroundColor = devs.length >= maxDev ? '#FFE4E6' : '#DBEAFE';
    countBadge.style.color = devs.length >= maxDev ? '#BE123C' : '#1D4ED8';

    if (devs.length === 0) {
      listEl.innerHTML = `
        <div style="font-size: 0.78rem; color: #64748B; font-weight: 700; padding: 10px 12px; background: #FFFFFF; border-radius: 8px; border: 1px dashed #CBD5E1; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <span>현재 등록된 기기가 없습니다 (0/${maxDev}대). 위 [정식판 잠금 해제]를 눌러 이 기기를 등록하세요.</span>
        </div>
      `;
      return;
    }

    listEl.innerHTML = devs
      .map((devStr, idx) => {
        const token = extractDeviceIdToken(devStr);
        const isMe = token === myDevId;
        return `
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 8px 12px; background: #FFFFFF; border-radius: 8px; border: 1.5px solid ${isMe ? '#93C5FD' : '#E2E8F0'};">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span style="background: ${isMe ? '#2563EB' : '#64748B'}; color: #FFFFFF; font-size: 0.7rem; font-weight: 900; padding: 2px 7px; border-radius: 6px;">
                기기 ${idx + 1}
              </span>
              <span style="font-size: 0.82rem; font-weight: 800; color: #0F172A;">
                ${escapeHtml(devStr)}
              </span>
              ${isMe ? `<span style="font-size: 0.72rem; font-weight: 900; color: #1D4ED8; background: #EFF6FF; padding: 2px 6px; border-radius: 5px;">💻 현재 접속 기기</span>` : ''}
            </div>
            <button
              type="button"
              class="header-btn"
              data-remove-cust-dev-idx="${idx}"
              style="height: 28px; padding: 0 10px; font-size: 0.74rem; font-weight: 800; color: #E11D48; border-color: #FECDD3; background: #FFF1F2;"
            >
              🗑️ 기기 삭제
            </button>
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('[data-remove-cust-dev-idx]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const removeIdx = Number(btn.getAttribute('data-remove-cust-dev-idx'));
        const removedEntry = devs[removeIdx];
        if (!removedEntry) return;
        btn.disabled = true;
        btn.textContent = '삭제 중...';

        const nextDevs = devs.filter((_, i) => i !== removeIdx);
        await saveCheckpointRecordState(targetKey, {
          ...record,
          devices: nextDevs
        });

        const removedIsMe = extractDeviceIdToken(removedEntry) === myDevId;
        if (removedIsMe) markLicenseKeyReleased(targetKey);
        if (removedIsMe && isFullLicense()) {
          state.licenseTier = 'TRIAL';
          state.appMode = 'SIMPLE';
          saveState();
          renderAll();
          const fbEl = document.getElementById('licenseActivateFeedback');
          if (fbEl) {
            fbEl.style.color = '#D97706';
            fbEl.textContent = `🔓 현재 기기(${removedEntry})가 등록 해제되어 체험판으로 전환되었습니다.`;
          }
        }
        await refreshCustomerDeviceManagerUI();
      });
    });
  }

  function renderLicenseStatus() {
    const badgeBtn = document.getElementById('btnOpenLicenseModal');
    const badgeIcon = document.getElementById('licenseHeaderIcon');
    const badgeText = document.getElementById('licenseHeaderBadgeText');
    const statusText = document.getElementById('licenseStatusCurrentText');
    const keyInput = document.getElementById('licenseKeyInput');
    const purchaseLinkEl = document.getElementById('btnPurchaseKakaoLink');
    const isFull = isFullLicense();

    if (purchaseLinkEl) {
      const savedContactUrl = localStorage.getItem('freshlabel_seller_contact_url') || DEFAULT_SELLER_PURCHASE_URL;
      purchaseLinkEl.href = savedContactUrl;
    }

    if (badgeBtn) {
      badgeBtn.classList.toggle('is-full', isFull);
      badgeBtn.title = isFull ? '정식판 (평생 소장권 인증됨)' : '무료 체험판 (클릭하여 30,000원 정식판 전환)';
    }
    if (badgeIcon) {
      badgeIcon.textContent = isFull ? '👑' : '🔒';
    }
    if (badgeText) {
      badgeText.textContent = isFull ? '정식판' : '체험판';
    }
    if (statusText) {
      statusText.textContent = isFull
        ? `현재 상태: 👑 30,000원 정식판 인증 완료 (${state.licenseKey || '평생 소장권'})`
        : '현재 상태: 무료 체험판 (핵심 샘플 6종 라벨 출력 체험 중)';
    }
    if (keyInput && document.activeElement !== keyInput && state.licenseKey) {
      keyInput.value = state.licenseKey;
    }
  }

  function openLicenseModal(lockReason = '') {
    const dialog = document.getElementById('licenseDialog');
    const alertBox = document.getElementById('licenseLockAlertBox');
    const alertText = document.getElementById('licenseLockAlertText');
    renderLicenseStatus();
    if (alertBox && alertText) {
      if (lockReason) {
        alertBox.style.display = 'block';
        alertText.textContent = lockReason;
      } else {
        alertBox.style.display = 'none';
      }
    }
    if (dialog) {
      dialog.showModal();
    }
    refreshCustomerDeviceManagerUI();
  }

  function showToast(_message) {
    // 상단 검은색 토스트 팝업 비활성화 (우측 상태 안내 박스에서 바로 확인)
    return;
  }

  function openPhotoZoom(title, imgUrl, caption) {
    if (!imgUrl) return;
    document.getElementById('photoZoomTitle').textContent = title || '촬영 사진 원본 보기';
    document.getElementById('photoZoomImg').src = imgUrl;
    document.getElementById('photoZoomCaption').textContent = caption || '';
    document.getElementById('photoZoomDialog').showModal();
  }

  // ==========================================================================
  // Render Functions
  // ==========================================================================

  function renderClock() {
    const now = new Date();
    const el = document.getElementById('liveClockDisplay');
    if (el) {
      el.textContent = formatDateTime(now);
    }

    // Real-time update of all preset expiry badges (especially 4H pearl & midnight rollovers)
    document.querySelectorAll('[data-live-preset-badge]').forEach((badgeEl) => {
      const pId = badgeEl.getAttribute('data-live-preset-badge');
      const preset = state.presets.find((p) => p.id === pId);
      if (preset) {
        const calc = calculateInclusiveExpiry(now, preset);
        badgeEl.textContent = calc.ruleBadgeText;
      }
    });

    // Real-time update of the sticker preview timestamp & expiry
    if (state.lastPrintedLabel) {
      const activePreset =
        state.presets.find((p) => p.id === state.lastPrintedLabel.presetId) ||
        state.presets.find((p) => p.fullName === state.lastPrintedLabel.itemName) ||
        state.presets[0];

      if (activePreset) {
        const liveCalc = calculateInclusiveExpiry(now, activePreset);
        const origExp =
          state.lastPrintedLabel.originalExpiryFormatted ||
          getOriginalExpiryFormattedForPreset(activePreset);
        state.lastPrintedLabel.originalExpiryFormatted = origExp;
        state.lastPrintedLabel.openedAtFormatted = liveCalc.openedAtFormatted;
        state.lastPrintedLabel.expiresAtFormatted = liveCalc.expiresAtFormatted;
        state.lastPrintedLabel.ruleDetailText = liveCalc.ruleDetailText;

        const sOrig = document.getElementById('simpleStickerOriginalExpiry');
        const sOpened = document.getElementById('simpleStickerOpened');
        const sExpires = document.getElementById('simpleStickerExpires');
        const pOrig = document.getElementById('stickerOriginalExpiry');
        const pOpened = document.getElementById('stickerOpenedAt');
        const pExpires = document.getElementById('stickerExpiresAt');

        if (sOrig) sOrig.textContent = origExp;
        if (sOpened) sOpened.textContent = liveCalc.openedAtFormatted;
        if (sExpires) sExpires.textContent = liveCalc.expiresAtFormatted;
        if (pOrig) pOrig.textContent = origExp;
        if (pOpened) pOpened.textContent = liveCalc.openedAtFormatted;
        if (pExpires) pExpires.textContent = liveCalc.expiresAtFormatted;
      }
    }
  }

  function renderStaffButtons() {
    const buttons = document.querySelectorAll('.staff-btn');
    buttons.forEach((btn) => {
      const staffName = btn.getAttribute('data-staff');
      btn.classList.toggle('active', staffName === state.currentStaff);
    });
  }

  function renderSlipCountBadges() {
    const count = (state.deliverySlips || []).length;
    const b1 = document.getElementById('slipArchiveCountBadge');
    const b2 = document.getElementById('tabSlipArchiveCount');
    if (b1) b1.textContent = String(count);
    if (b2) b2.textContent = String(count);
  }

  function getStatusBucket(dDay) {
    if (dDay <= 3) return 'danger';
    if (dDay <= 7) return 'warning';
    return 'safe';
  }

  function matchesDDayFilter(dDay, filterMode) {
    if (!filterMode || filterMode === 'ALL') return true;
    const bucket = getStatusBucket(dDay);
    if (filterMode === 'DANGER') return bucket === 'danger';
    if (filterMode === 'WARNING') return bucket === 'warning';
    if (filterMode === 'SAFE') return bucket === 'safe';
    return true;
  }

  function renderFifoInventory() {
    const listEl = document.getElementById('fifoInventoryList');
    if (!listEl) return;

    const viewModeSelect = document.getElementById('viewModeSelect');
    const ddayFilterSelect = document.getElementById('ddayFilterSelect');
    const zoneFilterSelect = document.getElementById('zoneFilterSelect');

    if (viewModeSelect) viewModeSelect.value = state.viewMode || 'BY_DAYS';
    if (zoneFilterSelect) zoneFilterSelect.value = state.selectedZone || 'ALL';

    const zoneProducts = state.unopenedProducts.filter((prod) => {
      if (state.selectedZone === 'ALL') return true;
      return prod.zone === state.selectedZone;
    });

    const allZoneLots = [];
    zoneProducts.forEach((prod) => {
      const sortedProdLots = prod.lots
        .filter((l) => l.qty > 0)
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

      sortedProdLots.forEach((lot, idx) => {
        const dDay = calcDDay(lot.expiryDate);
        allZoneLots.push({
          prod,
          lot,
          isFirstOfProd: idx === 0,
          dDay,
          statusClass: getStatusBucket(dDay)
        });
      });
    });

    const dangerCount = allZoneLots.filter((x) => x.statusClass === 'danger').length;
    const warningCount = allZoneLots.filter((x) => x.statusClass === 'warning').length;
    const safeCount = allZoneLots.filter((x) => x.statusClass === 'safe').length;

    const optAll = document.getElementById('optFilterAll');
    const optDanger = document.getElementById('optFilterDanger');
    const optWarning = document.getElementById('optFilterWarning');
    const optSafe = document.getElementById('optFilterSafe');

    if (optAll) optAll.textContent = `전체 날짜 (${allZoneLots.length}건)`;
    if (optDanger) optDanger.textContent = `위험 · D-3 이내 (${dangerCount}건)`;
    if (optWarning) optWarning.textContent = `주의 · D-4 ~ D-7 (${warningCount}건)`;
    if (optSafe) optSafe.textContent = `여유 · D-8 이상 (${safeCount}건)`;
    if (ddayFilterSelect) ddayFilterSelect.value = state.ddayFilter || 'ALL';

    const navBadgeStock = document.getElementById('navBadgeStock');
    if (navBadgeStock) navBadgeStock.textContent = String(allZoneLots.length);

    // MODE A: 남은 날짜별 보기 (D-Day 임박순)
    if (state.viewMode === 'BY_DAYS') {
      const filteredLots = allZoneLots
        .filter((entry) => matchesDDayFilter(entry.dDay, state.ddayFilter))
        .sort((a, b) => a.dDay - b.dDay || a.prod.name.localeCompare(b.prod.name));

      if (filteredLots.length === 0) {
        listEl.innerHTML = `
          <div style="padding: 36px 20px; text-align: center; color: var(--text-muted); font-weight: 600;">
            선택하신 남은 날짜 조건에 해당하는 미개봉 재고가 없습니다.
          </div>
        `;
        return;
      }

      const brackets = [
        {
          key: 'danger',
          title: '위험 · 남은 날짜 3일 이내 (D-Day ~ D-3)',
          sub: '최우선 개봉 대상 — 개봉 시 당일포함 안전보관일 라벨이 자동 출력됩니다',
          items: filteredLots.filter((x) => x.statusClass === 'danger')
        },
        {
          key: 'warning',
          title: '주의 · 남은 날짜 4일 ~ 7일 (D-4 ~ D-7)',
          sub: '이번 주 내 소진 권장 품목',
          items: filteredLots.filter((x) => x.statusClass === 'warning')
        },
        {
          key: 'safe',
          title: '여유 · 남은 날짜 8일 이상 (D-8+)',
          sub: '소비기한 여유 안전 재고 (임박순 정렬)',
          items: filteredLots.filter((x) => x.statusClass === 'safe')
        }
      ].filter((b) => b.items.length > 0);

      listEl.innerHTML = brackets
        .map((bracket) => {
          const rowsHtml = bracket.items
            .map(({ prod, lot, isFirstOfProd, dDay, statusClass }) => {
              let dDayTop = dDay >= 0 ? `D-${dDay}` : `D+${Math.abs(dDay)}`;
              if (dDay === 0) dDayTop = 'D-Day';
              const dDaySub =
                dDay < 0
                  ? `${Math.abs(dDay)}일 경과`
                  : dDay === 0
                  ? '오늘 만료'
                  : `${dDay}일 남음`;

              const thumbHtml = prod.photoUrl
                ? `<img src="${prod.photoUrl}" class="product-thumb" alt="${prod.name}" data-action="zoom-product-photo" data-product-id="${prod.id}" title="클릭하여 촬영된 물건 사진 크게 보기" />`
                : '';

              const priorityBadge = isFirstOfProd
                ? statusClass === 'danger'
                  ? `<span class="fifo-priority-tag">먼저 개봉! (임박 1순위)</span>`
                  : `<span class="fifo-priority-tag normal-priority">선입선출 1순위</span>`
                : `<span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">후순위 로트</span>`;

              const btnStyleClass = isFirstOfProd
                ? statusClass === 'danger'
                  ? 'urgent-fifo'
                  : 'primary-fifo'
                : 'secondary-fifo';

              return `
                <div class="dday-item-row">
                  <div class="dday-item-left tabular-nums">
                    <div class="dday-big-pill ${statusClass}">
                      <span class="dday-big-num">${dDayTop}</span>
                      <span class="dday-big-sub">${dDaySub}</span>
                    </div>
                    ${thumbHtml}
                    <div style="display: flex; flex-direction: column; gap: 3px;">
                      <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
                        <span class="product-name">${prod.name}</span>
                        <span class="lot-qty-text">${lot.qty}${prod.unit}</span>
                        <span class="product-zone-tag">${prod.zone}</span>
                      </div>
                      <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px;">
                        <span style="font-size: 0.8125rem; font-weight: 700; color: var(--text-secondary);">
                          포장기한: ${lot.expiryDate} (${formatShortDate(lot.expiryDate)})
                        </span>
                        ${priorityBadge}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="btn-open-pack ${btnStyleClass}"
                    data-action="open-lot"
                    data-product-id="${prod.id}"
                    data-lot-id="${lot.id}"
                    data-is-first="${isFirstOfProd}"
                  >
                    <span>-1${prod.unit} 개봉 + 라벨출력</span>
                  </button>
                </div>
              `;
            })
            .join('');

          return `
            <div class="dday-bracket-group bracket-${bracket.key}">
              <div class="dday-bracket-header ${bracket.key}">
                <span>${bracket.title} (${bracket.items.length}건)</span>
                <span style="font-size: 0.75rem; font-weight: 700; opacity: 0.9;">${bracket.sub}</span>
              </div>
              <div>
                ${rowsHtml}
              </div>
            </div>
          `;
        })
        .join('');

      return;
    }

    // MODE B: 품목별 묶음 보기
    listEl.innerHTML = zoneProducts
      .map((prod) => {
        const allActiveLots = prod.lots
          .filter((l) => l.qty > 0)
          .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

        const firstLotId = allActiveLots[0]?.id;
        const activeLots = allActiveLots.filter((l) =>
          matchesDDayFilter(calcDDay(l.expiryDate), state.ddayFilter)
        );

        if (activeLots.length === 0 && state.ddayFilter !== 'ALL') {
          return '';
        }

        const totalQty = allActiveLots.reduce((acc, item) => acc + item.qty, 0);

        const thumbHtml = prod.photoUrl
          ? `<img src="${prod.photoUrl}" class="product-thumb" alt="${prod.name}" data-action="zoom-product-photo" data-product-id="${prod.id}" title="클릭하여 촬영된 물건 사진 크게 보기" />`
          : '';

        if (allActiveLots.length === 0) {
          return `
            <div class="product-group">
              <div class="product-group-header">
                <div class="product-name-wrap">
                  ${thumbHtml}
                  <span class="product-name">${prod.name}</span>
                  <span class="product-zone-tag">${prod.zone}</span>
                </div>
                <span class="product-total-qty" style="color: var(--danger-text);">재고 소진 (0${prod.unit})</span>
              </div>
            </div>
          `;
        }

        const lotsHtml = activeLots
          .map((lot, idx) => {
            const isFirst = lot.id === firstLotId;
            const isLastRow = idx === activeLots.length - 1;
            const branchChar = isLastRow ? '└' : '├';
            const dDay = calcDDay(lot.expiryDate);

            let statusClass = getStatusBucket(dDay);
            let dDayLabel = dDay >= 0 ? `D-${dDay} (${dDay}일 남음)` : `기한경과 D+${Math.abs(dDay)}`;
            if (dDay === 0) dDayLabel = 'D-Day (오늘만료)';

            let priorityTagHtml = '';
            if (isFirst) {
              if (statusClass === 'danger') {
                priorityTagHtml = `<span class="fifo-priority-tag">먼저 개봉! (임박 1순위)</span>`;
              } else {
                priorityTagHtml = `<span class="fifo-priority-tag normal-priority">선입선출 1순위</span>`;
              }
            }

            const btnStyleClass = isFirst
              ? statusClass === 'danger'
                ? 'urgent-fifo'
                : 'primary-fifo'
              : 'secondary-fifo';

            return `
              <div class="lot-row ${isFirst ? 'fifo-first' : ''} status-${statusClass}">
                <div class="lot-info tabular-nums">
                  <span class="fifo-tree-branch">${branchChar}</span>
                  <span class="dday-badge ${statusClass}">${dDayLabel}</span>
                  <span class="lot-expiry-date">${formatShortDate(lot.expiryDate)} 만료</span>
                  <span class="lot-qty-text">${lot.qty}${prod.unit}</span>
                  ${priorityTagHtml}
                </div>
                <button
                  type="button"
                  class="btn-open-pack ${btnStyleClass}"
                  data-action="open-lot"
                  data-product-id="${prod.id}"
                  data-lot-id="${lot.id}"
                  data-is-first="${isFirst}"
                >
                  <span>-1${prod.unit} 개봉 + 라벨출력</span>
                </button>
              </div>
            `;
          })
          .join('');

        return `
          <div class="product-group">
            <div class="product-group-header">
              <div class="product-name-wrap">
                ${thumbHtml}
                <span class="product-name">${prod.name}</span>
                <span class="product-zone-tag">${prod.zone}</span>
                <label class="btn-mini-action" style="height: 24px; padding: 0 7px; font-size: 0.6875rem; display: inline-flex; align-items: center; cursor: pointer;">
                  <span>사진변경</span>
                  <input type="file" accept="image/*" capture="environment" data-action="quick-upload-prod-photo" data-product-id="${prod.id}" style="display:none;" />
                </label>
              </div>
              <span class="product-total-qty tabular-nums">총 ${totalQty}${prod.unit}</span>
            </div>
            <div class="lot-rows">
              ${lotsHtml}
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderPresetGrid() {
    const gridEl = document.getElementById('presetGrid');
    if (!gridEl) return;

    const catSelect = document.getElementById('presetCategorySelect');
    if (catSelect) catSelect.value = state.selectedPresetCategory || 'FAV';

    const query = (state.presetSearchQuery || '').trim().toLowerCase();
    const now = new Date();

    const filteredPresets = state.presets.filter((preset) => {
      if (query) {
        return (
          preset.title.toLowerCase().includes(query) ||
          preset.fullName.toLowerCase().includes(query) ||
          (preset.category || '').toLowerCase().includes(query) ||
          (preset.note || '').toLowerCase().includes(query)
        );
      }
      if (state.selectedPresetCategory === 'ALL') return true;
      if (state.selectedPresetCategory === 'FAV') return Boolean(preset.isFav);
      return preset.category === state.selectedPresetCategory;
    });

    if (filteredPresets.length === 0) {
      gridEl.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.8125rem; font-weight: 600;">
          검색 조건에 맞는 자재 프리셋이 없습니다.
        </div>
      `;
    } else {
      gridEl.innerHTML = filteredPresets
        .map((preset) => {
          const calc = calculateInclusiveExpiry(now, preset);
          const isSameDayOrHours = preset.days === 1 || Boolean(preset.hours);
          const storageShort = (preset.storage || '냉장').split(' ')[0];

          return `
            <button
              type="button"
              class="preset-card-btn ${isSameDayOrHours ? 'same-day-preset' : ''}"
              data-action="print-preset"
              data-preset-id="${preset.id}"
              title="${preset.note || ''}"
            >
              <div class="preset-card-top">
                <span class="preset-item-name">${preset.title}</span>
                <span style="font-size: 0.6875rem; font-weight: 800; color: var(--text-muted); flex-shrink: 0;">
                  ${preset.actionType || '소분'}·${storageShort}
                </span>
              </div>
              <span class="preset-rule-badge tabular-nums" data-live-preset-badge="${preset.id}">${calc.ruleBadgeText}</span>
            </button>
          `;
        })
        .join('');
    }

    const selectEl = document.getElementById('receiveLinkedPreset');
    if (selectEl) {
      selectEl.innerHTML = state.presets
        .map(
          (p) =>
            `<option value="${p.id}">[${p.category || '자재'}] ${p.title} (${
              p.hours ? p.hours + '시간' : '당일포함 ' + p.days + '일'
            })</option>`
        )
        .join('');
    }
  }

  function syncCategoryDropdowns() {
    const categories = [];
    state.presets.forEach((p) => {
      const cat = (p.category || '기타 자재').trim();
      if (cat && !categories.includes(cat)) {
        categories.push(cat);
      }
    });

    const totalCount = state.presets.length;
    const favCount = state.presets.filter((p) => p.isFav).length;
    const buildOptionsHtml = () => {
      const baseOpts = [
        `<option value="ALL">전체 품목 (${totalCount}종)</option>`,
        `<option value="FAV">★ 자주 쓰는 자재 (${favCount}종)</option>`
      ];
      categories.forEach((cat, idx) => {
        const cnt = state.presets.filter((p) => (p.category || '기타 자재').trim() === cat).length;
        baseOpts.push(`<option value="${cat}">${idx + 1}. ${cat} (${cnt}종)</option>`);
      });
      return baseOpts.join('');
    };

    const simpleSelect = document.getElementById('simpleCategorySelect');
    if (simpleSelect) {
      if (state.simpleCategory !== 'ALL' && state.simpleCategory !== 'FAV' && !categories.includes(state.simpleCategory)) {
        state.simpleCategory = 'ALL';
      }
      simpleSelect.innerHTML = buildOptionsHtml(state.simpleCategory);
      simpleSelect.value = state.simpleCategory || 'ALL';
    }

    const receiveSelect = document.getElementById('receiveCategorySelect');
    if (receiveSelect) {
      if (state.receiveCategory !== 'ALL' && state.receiveCategory !== 'FAV' && !categories.includes(state.receiveCategory)) {
        state.receiveCategory = 'ALL';
      }
      receiveSelect.innerHTML = buildOptionsHtml(state.receiveCategory);
      receiveSelect.value = state.receiveCategory || 'ALL';
    }

    const useSelect = document.getElementById('useCategorySelect');
    if (useSelect) {
      if (state.useCategory !== 'ALL' && state.useCategory !== 'FAV' && !categories.includes(state.useCategory)) {
        state.useCategory = 'ALL';
      }
      useSelect.innerHTML = buildOptionsHtml(state.useCategory);
      useSelect.value = state.useCategory || 'ALL';
    }

    const proSelect = document.getElementById('presetCategorySelect');
    if (proSelect) {
      if (state.selectedPresetCategory !== 'ALL' && state.selectedPresetCategory !== 'FAV' && !categories.includes(state.selectedPresetCategory)) {
        state.selectedPresetCategory = 'ALL';
      }
      proSelect.innerHTML = buildOptionsHtml(state.selectedPresetCategory);
      proSelect.value = state.selectedPresetCategory || 'ALL';
    }

    const datalistEl = document.getElementById('presetCategoryList');
    if (datalistEl) {
      datalistEl.innerHTML = categories.map((c) => `<option value="${c}"></option>`).join('');
    }
  }

  function renderManualReferenceTable() {
    const tbody = document.getElementById('manualReferenceTableBody');
    if (!tbody) return;
    const now = new Date();

    const brandSelectEl = document.getElementById('brandTemplateSelect');
    if (brandSelectEl) {
      brandSelectEl.value = state.brandTemplate || 'MEGA';
    }

    const brandNameInputEl = document.getElementById('customBrandNameInput');
    if (brandNameInputEl) {
      brandNameInputEl.value = state.brandName || '메가MGC커피';
    }

    const badgeTextEl = document.getElementById('currentBrandBadgeText');
    if (badgeTextEl) {
      badgeTextEl.textContent = `${state.brandName || '메가MGC커피'} (${state.presets.length}종)`;
    }

    tbody.innerHTML = state.presets
      .map((p) => {
        const calc = calculateInclusiveExpiry(now, p);
        return `
          <tr>
            <td style="font-weight: 800; color: var(--text-secondary);">${p.category || '-'}</td>
            <td style="font-weight: 800; color: var(--text-primary);">${p.title}</td>
            <td><span class="product-zone-tag">${p.actionType || '소분'}</span></td>
            <td class="tabular-nums" style="font-weight: 800; color: var(--accent-text);">
              ${p.hours ? `${p.hours}시간 (${calc.expiresShortPreview})` : `${p.days}일 (${calc.expiresShortPreview})`}
            </td>
            <td style="font-weight: 700;">${p.storage}</td>
            <td style="color: var(--text-muted); font-size: 0.75rem;">${p.note || '-'}</td>
            <td>
              <div style="display: inline-flex; align-items: center; gap: 4px;">
                <button
                  type="button"
                  class="btn-mini-action"
                  data-action="print-from-manual"
                  data-preset-id="${p.id}"
                  style="border-color: var(--accent-primary); color: var(--accent-text); background-color: var(--accent-surface);"
                >라벨출력</button>
                <button
                  type="button"
                  class="btn-mini-action dispose-btn"
                  data-action="delete-from-manual"
                  data-preset-id="${p.id}"
                >삭제</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function getBrandTemplateData(templateKey) {
    if (templateKey === 'FRANCHISE') {
      return {
        brandName: '프랜차이즈 표준',
        presets: [
          { id: 'fr-1', category: '우유·크림', actionType: '개봉', title: '우유 1L (개봉)', fullName: '우유 1L (개봉)', days: 3, storage: '냉장 (0~10℃)', unit: '팩', note: '개봉 후 당일포함 3일', isFav: true },
          { id: 'fr-2', category: '우유·크림', actionType: '소분', title: '연유 (소분)', fullName: '연유 (소분)', days: 7, storage: '냉장 (0~10℃)', unit: '통', note: '소분 후 당일포함 7일', isFav: true },
          { id: 'fr-3', category: '우유·크림', actionType: '제조', title: '휘핑크림 (제조)', fullName: '휘핑크림 (제조)', days: 3, storage: '냉장 (0~10℃)', unit: '통', note: '제조 후 당일포함 3일', isFav: true },
          { id: 'fr-4', category: '시럽·소스', actionType: '개봉', title: '바닐라시럽 (개봉)', fullName: '바닐라시럽 (개봉)', days: 30, storage: '실온 (1~35℃)', unit: '병', note: '개봉 후 당일포함 30일', isFav: true },
          { id: 'fr-5', category: '시럽·소스', actionType: '개봉', title: '헤이즐넛시럽 (개봉)', fullName: '헤이즐넛시럽 (개봉)', days: 30, storage: '실온 (1~35℃)', unit: '병', note: '개봉 후 당일포함 30일', isFav: false },
          { id: 'fr-6', category: '시럽·소스', actionType: '소분', title: '초코소스 (소분)', fullName: '초코소스 (소분)', days: 14, storage: '실온 (1~35℃)', unit: '통', note: '소분 후 당일포함 14일', isFav: true },
          { id: 'fr-7', category: '시럽·소스', actionType: '소분', title: '카라멜소스 (소분)', fullName: '카라멜소스 (소분)', days: 14, storage: '실온 (1~35℃)', unit: '통', note: '소분 후 당일포함 14일', isFav: true },
          { id: 'fr-8', category: '과일베이스', actionType: '소분', title: '딸기베이스 (소분)', fullName: '딸기베이스 (소분)', days: 7, storage: '냉장 (0~10℃)', unit: '통', note: '소분 후 당일포함 7일', isFav: true },
          { id: 'fr-9', category: '과일베이스', actionType: '소분', title: '자몽베이스 (소분)', fullName: '자몽베이스 (소분)', days: 14, storage: '냉장 (0~10℃)', unit: '통', note: '소분 후 당일포함 14일', isFav: false },
          { id: 'fr-10', category: '과일베이스', actionType: '소분', title: '레몬베이스 (소분)', fullName: '레몬베이스 (소분)', days: 14, storage: '냉장 (0~10℃)', unit: '통', note: '소분 후 당일포함 14일', isFav: false },
          { id: 'fr-11', category: '과일베이스', actionType: '소분', title: '복숭아아이스티 (소분)', fullName: '복숭아아이스티 (소분)', days: 14, storage: '실온 (1~35℃)', unit: '통', note: '소분 후 당일포함 14일', isFav: true },
          { id: 'fr-12', category: '파우더·토핑', actionType: '소분', title: '초코파우더 (소분)', fullName: '초코파우더 (소분)', days: 14, storage: '실온 (1~35℃)', unit: '통', note: '소분 후 당일포함 14일', isFav: true },
          { id: 'fr-13', category: '파우더·토핑', actionType: '소분', title: '녹차파우더 (소분)', fullName: '녹차파우더 (소분)', days: 14, storage: '실온 (1~35℃)', unit: '통', note: '소분 후 당일포함 14일', isFav: false },
          { id: 'fr-14', category: '파우더·토핑', actionType: '소분', title: '미숫가루·곡물파우더 (소분)', fullName: '미숫가루·곡물파우더 (소분)', days: 14, storage: '실온 (1~35℃)', unit: '통', note: '소분 후 당일포함 14일', isFav: false },
          { id: 'fr-15', category: '펄·커피', actionType: '제조', title: '삶은 타피오카펄 (4H)', fullName: '삶은 타피오카펄 (4H)', days: 1, hours: 4, storage: '보온 (60~70℃)', unit: '통', note: '제조 후 4시간 보온 후 폐기', isFav: true },
          { id: 'fr-16', category: '펄·커피', actionType: '개봉', title: '콜드브루 원액 (개봉)', fullName: '콜드브루 원액 (개봉)', days: 7, storage: '냉장 (0~10℃)', unit: '병', note: '개봉 후 당일포함 7일', isFav: true },
          { id: 'fr-17', category: '펄·커피', actionType: '소분', title: '원두 홀빈 (그라인더)', fullName: '원두 홀빈 (그라인더)', days: 2, storage: '실온 (1~35℃)', unit: '봉', note: '호퍼 소분 후 당일포함 2일', isFav: false },
          { id: 'fr-18', category: '디저트·베이커리', actionType: '해동', title: '치즈케익 (해동)', fullName: '치즈케익 (해동)', days: 3, storage: '냉장 (0~10℃)', unit: '개', note: '해동 후 당일포함 3일', isFav: false },
          { id: 'fr-19', category: '디저트·베이커리', actionType: '해동', title: '크로플 생지 (해동)', fullName: '크로플 생지 (해동)', days: 2, storage: '냉장 (0~10℃)', unit: '개', note: '해동 후 당일포함 2일', isFav: false },
          { id: 'fr-20', category: '디저트·베이커리', actionType: '해동', title: '베이글 (해동)', fullName: '베이글 (해동)', days: 3, storage: '냉장 (0~10℃)', unit: '개', note: '해동 후 당일포함 3일', isFav: false }
        ]
      };
    }

    if (templateKey === 'PERSONAL') {
      return {
        brandName: '개인 카페·베이커리',
        presets: [
          { id: 'ps-1', category: '수제청·베이스', actionType: '제조', title: '수제 자몽청 (소분)', fullName: '수제 자몽청 (소분)', days: 14, storage: '냉장 (0~10℃)', unit: '병', note: '수제 제조/소분 후 당일포함 14일', isFav: true },
          { id: 'ps-2', category: '수제청·베이스', actionType: '제조', title: '수제 레몬청 (소분)', fullName: '수제 레몬청 (소분)', days: 14, storage: '냉장 (0~10℃)', unit: '병', note: '수제 제조/소분 후 당일포함 14일', isFav: true },
          { id: 'ps-3', category: '수제청·베이스', actionType: '제조', title: '수제 딸기라떼청 (제조)', fullName: '수제 딸기라떼청 (제조)', days: 5, storage: '냉장 (0~10℃)', unit: '통', note: '수제 제조 후 당일포함 5일', isFav: true },
          { id: 'ps-4', category: '수제청·베이스', actionType: '제조', title: '수제 바닐라빈 시럽 (제조)', fullName: '수제 바닐라빈 시럽 (제조)', days: 14, storage: '냉장 (0~10℃)', unit: '병', note: '제조 후 당일포함 14일', isFav: true },
          { id: 'ps-5', category: '크림·우유', actionType: '제조', title: '아인슈페너 수제크림 (제조)', fullName: '아인슈페너 수제크림 (제조)', days: 2, storage: '냉장 (0~10℃)', unit: '통', note: '제조 후 당일포함 2일', isFav: true },
          { id: 'ps-6', category: '크림·우유', actionType: '제조', title: '마스카포네 티라미수크림', fullName: '마스카포네 티라미수크림 (제조)', days: 2, storage: '냉장 (0~10℃)', unit: '통', note: '제조 후 당일포함 2일', isFav: true },
          { id: 'ps-7', category: '크림·우유', actionType: '개봉', title: '우유 1L (개봉)', fullName: '우유 1L (개봉)', days: 3, storage: '냉장 (0~10℃)', unit: '팩', note: '개봉 후 당일포함 3일', isFav: true },
          { id: 'ps-8', category: '크림·우유', actionType: '개봉', title: '오트밀크·귀리우유 (개봉)', fullName: '오트밀크·귀리우유 (개봉)', days: 5, storage: '냉장 (0~10℃)', unit: '팩', note: '개봉 후 당일포함 5일', isFav: true },
          { id: 'ps-9', category: '크림·우유', actionType: '개봉', title: '동물성 생크림 (개봉)', fullName: '동물성 생크림 (개봉)', days: 3, storage: '냉장 (0~10℃)', unit: '팩', note: '개봉 후 당일포함 3일', isFav: false },
          { id: 'ps-10', category: '파우더·소스', actionType: '제조', title: '교토 말차베이스 (제조)', fullName: '교토 말차베이스 (제조)', days: 3, storage: '냉장 (0~10℃)', unit: '통', note: '제조 후 당일포함 3일', isFav: true },
          { id: 'ps-11', category: '파우더·소스', actionType: '제조', title: '발로나 초코베이스 (제조)', fullName: '발로나 초코베이스 (제조)', days: 5, storage: '냉장 (0~10℃)', unit: '통', note: '제조 후 당일포함 5일', isFav: true },
          { id: 'ps-12', category: '원두·콜드브루', actionType: '제조', title: '콜드브루 더치원액 (추출)', fullName: '콜드브루 더치원액 (추출)', days: 5, storage: '냉장 (0~10℃)', unit: '병', note: '추출 후 당일포함 5일', isFav: true },
          { id: 'ps-13', category: '원두·콜드브루', actionType: '개봉', title: '디카페인 원두 (소분)', fullName: '디카페인 원두 (소분)', days: 7, storage: '실온 (1~35℃)', unit: '통', note: '밀폐 소분 후 당일포함 7일', isFav: false },
          { id: 'ps-14', category: '구움과자·케익', actionType: '해동', title: '바스크 치즈케익 (해동)', fullName: '바스크 치즈케익 (해동)', days: 3, storage: '냉장 (0~10℃)', unit: '개', note: '해동 후 당일포함 3일', isFav: true },
          { id: 'ps-15', category: '구움과자·케익', actionType: '제조', title: '휘낭시에·마들렌 (당일)', fullName: '휘낭시에·마들렌 (당일)', days: 2, storage: '실온 (1~35℃)', unit: '개', note: '제조 후 당일포함 2일', isFav: false },
          { id: 'ps-16', category: '구움과자·케익', actionType: '해동', title: '소금빵 생지 (냉장해동)', fullName: '소금빵 생지 (냉장해동)', days: 2, storage: '냉장 (0~10℃)', unit: '개', note: '해동 후 당일포함 2일', isFav: false }
        ]
      };
    }

    const def = createDefaultState();
    return {
      brandName: '메가MGC커피',
      presets: def.presets
    };
  }

  function rebuildProductsFromPresets(presetsList) {
    const now = new Date();
    return presetsList.map((p, idx) => {
      let zone = '시럽·소스·베이스 냉장';
      const cat = p.category || '';
      if (cat.includes('우유') || cat.includes('크림')) zone = '우유·유제품 냉장';
      else if (cat.includes('베이커리') || cat.includes('케익') || cat.includes('디저트') || cat.includes('구움과자') || cat.includes('과일')) zone = '베이커리·과일 쇼케이스';
      else if (cat.includes('파우더') || cat.includes('토핑') || cat.includes('원두') || (p.storage || '').includes('실온')) zone = '커피바·파우더·실온';

      const unit = p.unit || (cat.includes('우유') ? '팩' : cat.includes('베이커리') || cat.includes('케익') || cat.includes('구움과자') ? '개' : '통');
      const initialQty = typeof p.initialQty === 'number' && !isNaN(p.initialQty) ? p.initialQty : 8;
      const daysOffset = Math.max(7, (Number(p.days) || 5) + 5 + (idx % 6));
      const expStr = addDaysToDateStr(now, daysOffset);

      return {
        id: `prod-${p.id}`,
        name: p.title,
        unit,
        zone,
        linkedPresetId: p.id,
        photoUrl: generateProductPhotoDataUrl(p.title, `${zone} · ${p.storage}`, '#059669', expStr),
        lots: [
          {
            id: `lot-${p.id}-1`,
            expiryDate: expStr,
            qty: initialQty
          }
        ]
      };
    });
  }

  function parseCsvRow(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  function parseCsvTextToPresets(csvText) {
    const cleanText = csvText.replace(/^\uFEFF/, '').trim();
    if (!cleanText) return [];

    const rawLines = cleanText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));

    if (rawLines.length === 0) return [];

    const firstRow = parseCsvRow(rawLines[0]);
    const headerKeywords = ['분류', '카테고리', 'category', '자재명', '품목명', '상품명', '이름', 'name', 'title', '보관일', '일수', '유통기한', '소비기한', 'days', '기준', '보관방법'];
    const hasHeader = firstRow.some((cell) =>
      headerKeywords.some((kw) => cell.toLowerCase().includes(kw))
    );

    let colMap = {
      category: 0,
      title: 1,
      actionType: 2,
      days: 3,
      storage: 4,
      unit: 5,
      initialQty: 6,
      note: 7
    };

    let startIdx = 0;
    if (hasHeader) {
      startIdx = 1;
      colMap = {
        category: -1,
        title: -1,
        actionType: -1,
        days: -1,
        storage: -1,
        unit: -1,
        initialQty: -1,
        note: -1
      };
      firstRow.forEach((colName, idx) => {
        const c = colName.replace(/\s+/g, '').toLowerCase();
        if (c.includes('분류') || c.includes('카테고리') || c.includes('category')) colMap.category = idx;
        else if (c.includes('자재') || c.includes('품목') || c.includes('상품') || c.includes('이름') || c.includes('name') || c.includes('title')) {
          if (colMap.title === -1) colMap.title = idx;
        } else if (c.includes('기준') || c.includes('구분') || c.includes('유형') || c.includes('type')) colMap.actionType = idx;
        else if (c.includes('보관일') || c.includes('일수') || c.includes('기한') || c.includes('days') || c.includes('시간')) colMap.days = idx;
        else if (c.includes('보관방법') || c.includes('보관온도') || c === '보관' || c.includes('storage')) colMap.storage = idx;
        else if (c.includes('단위') || c.includes('unit')) colMap.unit = idx;
        else if (c.includes('재고') || c.includes('수량') || c.includes('qty')) colMap.initialQty = idx;
        else if (c.includes('비고') || c.includes('해동') || c.includes('메모') || c.includes('note')) colMap.note = idx;
      });

      if (colMap.title === -1) {
        colMap.title = firstRow.length > 1 ? 1 : 0;
      }
      if (colMap.days === -1) {
        colMap.days = firstRow.length > 3 ? 3 : Math.min(2, firstRow.length - 1);
      }
    }

    const imported = [];
    const ts = Date.now();

    for (let i = startIdx; i < rawLines.length; i += 1) {
      const cols = parseCsvRow(rawLines[i]);
      if (cols.length === 0) continue;

      const rawTitle = (colMap.title >= 0 ? cols[colMap.title] : cols[0]) || '';
      if (!rawTitle) continue;

      const category = (colMap.category >= 0 && cols[colMap.category] ? cols[colMap.category] : '기본 자재').trim();
      const actionType = (colMap.actionType >= 0 && cols[colMap.actionType] ? cols[colMap.actionType] : '소분').trim();
      const rawDaysStr = (colMap.days >= 0 && cols[colMap.days] ? cols[colMap.days] : '5').trim();

      let days = 5;
      let hours = null;
      const hourMatch = rawDaysStr.match(/(\d+)\s*(시간|h|hr)/i);
      if (hourMatch) {
        hours = Math.max(1, parseInt(hourMatch[1], 10));
        days = 1;
      } else if (rawDaysStr.includes('당일')) {
        days = 1;
      } else {
        const numMatch = rawDaysStr.match(/(\d+)/);
        days = numMatch ? Math.max(1, parseInt(numMatch[1], 10)) : 5;
      }

      let storage = (colMap.storage >= 0 && cols[colMap.storage] ? cols[colMap.storage] : '냉장 (0~10℃)').trim();
      if (storage === '냉장') storage = '냉장 (0~10℃)';
      else if (storage === '실온' || storage === '상온') storage = '실온 (1~35℃)';
      else if (storage === '냉동') storage = '냉동 (-18℃ 이하)';
      else if (storage === '보온') storage = '보온 (60~70℃)';

      const unit = (colMap.unit >= 0 && cols[colMap.unit] ? cols[colMap.unit] : '통').trim() || '통';
      const rawQty = colMap.initialQty >= 0 && cols[colMap.initialQty] ? parseInt(cols[colMap.initialQty], 10) : 8;
      const initialQty = !isNaN(rawQty) && rawQty >= 0 ? rawQty : 8;

      const note =
        (colMap.note >= 0 && cols[colMap.note] ? cols[colMap.note] : '').trim() ||
        (hours ? `${actionType} 후 ${hours}시간` : `${actionType} 후 당일포함 ${days}일`);

      const displayTitle = rawTitle.includes('(') ? rawTitle : `${rawTitle} (${actionType})`;

      const presetObj = {
        id: `csv-${ts}-${i}`,
        category,
        actionType,
        title: displayTitle,
        fullName: displayTitle,
        days,
        storage,
        unit,
        initialQty,
        note,
        isFav: i - startIdx < 16
      };
      if (hours) presetObj.hours = hours;

      imported.push(presetObj);
    }

    return imported;
  }

  async function readCsvFileAsText(file) {
    const buffer = await file.arrayBuffer();
    try {
      const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
      return utf8Decoder.decode(buffer);
    } catch (_) {
      const eucKrDecoder = new TextDecoder('euc-kr');
      return eucKrDecoder.decode(buffer);
    }
  }

  function updateCsvBannerMessage(message, isSuccess = true) {
    const bannerEl = document.getElementById('csvImportBanner');
    if (!bannerEl) return;
    bannerEl.classList.toggle('success', isSuccess);
    bannerEl.innerHTML = message;
  }

  function exportCurrentPresetsToCsv() {
    const brandName = (state.brandName || 'FreshLabel').replace(/[\\/:*?"<>|]/g, '_');
    const header = ['분류', '자재명', '기준', '안전보관일(당일포함)', '보관방법', '단위', '현재재고', '비고'];
    const rows = state.presets.map((p) => {
      const prod = getOrEnsureProductForPreset(p, false);
      const totalQty = prod.lots.filter((l) => l.qty > 0).reduce((acc, l) => acc + l.qty, 0);
      const cleanName = p.title.replace(/\s*\((개봉|소분|제조|해동|당일|세척 후|4H)\)\s*$/, '');
      const dayVal = p.hours ? `${p.hours}시간` : `${p.days}일`;
      const cells = [
        p.category || '기본분류',
        cleanName,
        p.actionType || '소분',
        dayVal,
        p.storage || '냉장 (0~10℃)',
        prod.unit || '통',
        String(totalQty),
        p.note || ''
      ];
      return cells
        .map((c) => {
          const s = String(c ?? '');
          return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(',');
    });

    const csvContent = '\uFEFF' + [header.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${brandName}_안전보관일_기준표.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    updateCsvBannerMessage(
      `✓ <strong>[${brandName}_안전보관일_기준표.csv]</strong> 파일(${state.presets.length}종)이 다운로드되었습니다. 엑셀에서 자유롭게 수정 후 다시 가져올 수 있습니다.`,
      true
    );
  }

  function downloadSampleCsvTemplate() {
    const sampleRows = [
      ['분류', '자재명', '기준', '안전보관일(당일포함)', '보관방법', '단위', '초기재고', '비고'],
      ['수제청·베이스', '수제 자몽청', '소분', '14일', '냉장 (0~10℃)', '병', '10', '소분 후 당일포함 14일'],
      ['수제청·베이스', '수제 레몬청', '소분', '14일', '냉장 (0~10℃)', '병', '8', '소분 후 당일포함 14일'],
      ['수제청·베이스', '수제 딸기라떼베이스', '제조', '5일', '냉장 (0~10℃)', '통', '6', '제조 후 당일포함 5일'],
      ['우유·크림', '우유 1L', '개봉', '3일', '냉장 (0~10℃)', '팩', '20', '개봉 후 당일포함 3일'],
      ['우유·크림', '오트밀크(귀리우유)', '개봉', '5일', '냉장 (0~10℃)', '팩', '12', '개봉 후 당일포함 5일'],
      ['우유·크림', '아인슈페너 크림', '제조', '2일', '냉장 (0~10℃)', '통', '5', '제조 후 당일포함 2일'],
      ['시럽·소스', '바닐라빈 시럽', '제조', '14일', '냉장 (0~10℃)', '병', '8', '제조 후 당일포함 14일'],
      ['파우더·토핑', '교토 말차베이스', '제조', '3일', '냉장 (0~10℃)', '통', '6', '제조 후 당일포함 3일'],
      ['펄·커피', '삶은 타피오카펄', '제조', '4시간', '보온 (60~70℃)', '통', '8', '제조 후 4시간 보온'],
      ['디저트·베이커리', '바스크 치즈케익', '해동', '3일', '냉장 (0~10℃)', '개', '10', '해동 후 당일포함 3일']
    ];

    const csvContent = '\uFEFF' + sampleRows.map((r) => r.join(',')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '식자재_안전보관일_샘플양식.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    updateCsvBannerMessage(
      `✓ <strong>[식자재_안전보관일_샘플양식.csv]</strong> 파일이 다운로드되었습니다. 엑셀로 열어 우리 매장/브랜드 품목으로 작성 후 [CSV 가져오기]로 올려주세요!`,
      true
    );
  }

  function getOrEnsureProductForPreset(preset, shouldPersist = true) {
    let prod = state.unopenedProducts.find((p) => p.linkedPresetId === preset.id);
    if (!prod) {
      let zone = '시럽·소스·베이스 냉장';
      if (preset.category === '우유·크림') zone = '우유·유제품 냉장';
      else if (preset.category === '베이커리·케익' || preset.category === '펄·과일·커피') zone = '베이커리·과일 쇼케이스';
      else if (preset.category === '파우더·토핑') zone = '커피바·파우더·실온';

      const defaultExpiry = addDaysToDateStr(new Date(), Math.max(9, Number(preset.days) || 9));
      prod = {
        id: `prod-auto-${preset.id}`,
        name: preset.title,
        unit: preset.category === '우유·크림' ? '팩' : preset.category === '베이커리·케익' ? '개' : '통',
        zone,
        linkedPresetId: preset.id,
        photoUrl: generateProductPhotoDataUrl(preset.title, `${zone} · ${preset.storage}`, '#059669', defaultExpiry),
        lots: [
          {
            id: `lot-auto-${preset.id}`,
            expiryDate: defaultExpiry,
            qty: 0
          }
        ]
      };
      if (shouldPersist) {
        state.unopenedProducts.push(prod);
      }
    }
    return prod;
  }

  function getOriginalExpiryFormattedForPreset(preset, explicitExpiryDateStr) {
    if (explicitExpiryDateStr) {
      return explicitExpiryDateStr.replace(/-/g, '.');
    }
    if (!preset) {
      return addDaysToDateStr(new Date(), 10).replace(/-/g, '.');
    }
    const prod = getOrEnsureProductForPreset(preset, false);
    const activeLots = (prod.lots || [])
      .filter((l) => l.qty > 0)
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    const bestLot = activeLots[0] || (prod.lots && prod.lots[0]);
    if (bestLot && bestLot.expiryDate) {
      return bestLot.expiryDate.replace(/-/g, '.');
    }
    return addDaysToDateStr(new Date(), Math.max(9, Number(preset.days) || 9)).replace(/-/g, '.');
  }

  function renderFavPickerModal() {
    const pickerGrid = document.getElementById('favPickerModalGrid');
    if (!pickerGrid) return;
    const searchEl = document.getElementById('favModalSearchInput');
    const q = ((searchEl && searchEl.value) || '').trim().toLowerCase();

    const list = state.presets.filter((p) => {
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    });

    pickerGrid.innerHTML = list
      .map((p) => {
        const isFav = Boolean(p.isFav);
        return `
          <div
            class="fav-picker-item ${isFav ? 'checked' : ''}"
            data-action="modal-toggle-fav"
            data-preset-id="${p.id}"
            role="checkbox"
            aria-checked="${isFav}"
            tabindex="0"
          >
            <span style="font-size: 1rem; color: ${isFav ? '#D97706' : '#94A3B8'};">${isFav ? '★' : '☆'}</span>
            <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.title}</span>
          </div>
        `;
      })
      .join('');
  }

  function renderSimpleModeWorkspace() {
    const gridEl = document.getElementById('simpleKioskGrid');
    if (!gridEl) return;

    const catSelect = document.getElementById('simpleCategorySelect');
    if (catSelect) catSelect.value = state.simpleCategory || 'ALL';

    const scrollBodyEl = document.getElementById('simpleKioskScrollBody');
    const btnToggleBigFav = document.getElementById('btnToggleBigFavMode');
    const bigFavLabel = document.getElementById('bigFavModeLabel');
    const simpleFavColsSwitcher = document.getElementById('simpleFavColsSwitcher');
    if (scrollBodyEl) {
      scrollBodyEl.classList.toggle('big-fav-only-mode', Boolean(state.bigFavOnly));
    }
    if (btnToggleBigFav) {
      btnToggleBigFav.classList.toggle('active', Boolean(state.bigFavOnly));
    }
    if (bigFavLabel) {
      bigFavLabel.textContent = state.bigFavOnly ? '✕ 자주 쓰는 품목 끄기' : '★ 자주 쓰는 품목';
    }
    if (simpleFavColsSwitcher) {
      simpleFavColsSwitcher.style.display = state.bigFavOnly ? 'inline-flex' : 'none';
    }

    const favGridEl = document.getElementById('favGiantGrid');
    const favCols = state.favCols || 3;
    if (favGridEl) {
      favGridEl.setAttribute('data-cols', String(favCols));
    }
    document.querySelectorAll('.fav-col-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.getAttribute('data-fav-cols')) === Number(favCols));
    });

    const query = (state.simpleSearchQuery || '').trim().toLowerCase();
    const now = new Date();

    const favPresets = state.presets.filter((p) => {
      if (!p.isFav) return false;
      if (query) {
        return (
          p.title.toLowerCase().includes(query) ||
          p.fullName.toLowerCase().includes(query) ||
          (p.category || '').toLowerCase().includes(query)
        );
      }
      return true;
    });

    if (favGridEl) {
      if (favPresets.length === 0) {
        favGridEl.innerHTML = `
          <div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.875rem; font-weight: 700; background: #FFFFFF; border: 1px dashed var(--border-strong); border-radius: 10px;">
            상단의 [★ 품목 선택]을 눌러 자주 쓰는 제품을 등록해 주세요.
          </div>
        `;
      } else {
        favGridEl.innerHTML = favPresets
          .map((preset) => {
            const calc = calculateInclusiveExpiry(now, preset);
            const storageShort = (preset.storage || '냉장').split(' ')[0];

            return `
              <div
                class="fav-giant-card"
                data-action="print-label-only"
                data-preset-id="${preset.id}"
                role="button"
                tabindex="0"
              >
                <div class="simple-kiosk-top">
                  <div class="fav-giant-title">${preset.title}</div>
                  <div style="display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;">
                    <span class="simple-stock-pill">${storageShort}</span>
                    <button
                      type="button"
                      class="btn-fav-star is-fav"
                      data-action="toggle-fav-item"
                      data-preset-id="${preset.id}"
                      title="대형 버튼에서 제외"
                    >★</button>
                  </div>
                </div>

                <div class="simple-kiosk-bottom tabular-nums">
                  <span data-live-preset-badge="${preset.id}">${calc.ruleBadgeText}</span>
                  <span>라벨 출력 →</span>
                </div>
              </div>
            `;
          })
          .join('');
      }
    }

    const filteredPresets = state.presets.filter((preset) => {
      if (query) {
        return (
          preset.title.toLowerCase().includes(query) ||
          preset.fullName.toLowerCase().includes(query) ||
          (preset.category || '').toLowerCase().includes(query) ||
          (preset.note || '').toLowerCase().includes(query)
        );
      }
      if (state.simpleCategory === 'ALL') return true;
      if (state.simpleCategory === 'FAV') return Boolean(preset.isFav);
      return preset.category === state.simpleCategory;
    });

    // 무료 체험판일 때는 바로 눌러볼 수 있는 대표 샘플 6종을 맨 위로 정렬해 한눈에 보이게 배치
    if (!isFullLicense()) {
      filteredPresets.sort((a, b) => {
        const ua = isPresetUnlockedInTrial(a) ? 0 : 1;
        const ub = isPresetUnlockedInTrial(b) ? 0 : 1;
        return ua - ub;
      });
    }

    if (filteredPresets.length === 0) {
      gridEl.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 36px; text-align: center; color: var(--text-muted); font-weight: 700;">
          검색하신 내용물과 일치하는 품목이 없습니다.
        </div>
      `;
      return;
    }

    const isFull = isFullLicense();
    gridEl.innerHTML = filteredPresets
      .map((preset) => {
        const calc = calculateInclusiveExpiry(now, preset);
        const storageShort = (preset.storage || '냉장').split(' ')[0];
        const isFav = Boolean(preset.isFav);
        const isUnlocked = isPresetUnlockedInTrial(preset);
        const trialBadgeHtml = !isFull && isUnlocked
          ? `<span class="trial-unlocked-pill">무료체험</span>`
          : '';

        return `
          <div
            class="simple-kiosk-card ${isUnlocked ? '' : 'is-trial-locked'}"
            data-action="print-label-only"
            data-preset-id="${preset.id}"
            role="button"
            tabindex="0"
          >
            <div class="simple-kiosk-top">
              <div class="simple-kiosk-name">${trialBadgeHtml}${isUnlocked ? '' : '🔒 '}${preset.title}</div>
              <div style="display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;">
                <span class="simple-stock-pill">${storageShort}</span>
                <button
                  type="button"
                  class="btn-fav-star ${isFav ? 'is-fav' : ''}"
                  data-action="toggle-fav-item"
                  data-preset-id="${preset.id}"
                  title="${isFav ? '대형화면 분할에서 빼기' : '대형화면 분할에 추가'}"
                >${isFav ? '★' : '☆'}</button>
              </div>
            </div>

            <div class="simple-kiosk-bottom tabular-nums">
              <span data-live-preset-badge="${preset.id}">${calc.ruleBadgeText}</span>
              <span>${isUnlocked ? '라벨 출력 →' : '정식판 전용 (3만원)'}</span>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderUseModeWorkspace() {
    const gridEl = document.getElementById('useKioskGrid');
    if (!gridEl) return;

    const catSelect = document.getElementById('useCategorySelect');
    if (catSelect) catSelect.value = state.useCategory || 'ALL';

    const scrollBodyEl = document.getElementById('useKioskScrollBody');
    const btnToggleUseBigFav = document.getElementById('btnToggleUseBigFavMode');
    const useBigFavLabel = document.getElementById('useBigFavModeLabel');
    const useFavColsSwitcher = document.getElementById('useFavColsSwitcher');
    if (scrollBodyEl) {
      scrollBodyEl.classList.toggle('big-fav-only-mode', Boolean(state.useBigFavOnly));
    }
    if (btnToggleUseBigFav) {
      btnToggleUseBigFav.classList.toggle('active', Boolean(state.useBigFavOnly));
    }
    if (useBigFavLabel) {
      useBigFavLabel.textContent = state.useBigFavOnly ? '✕ 자주 쓰는 품목 끄기' : '★ 자주 쓰는 품목';
    }
    if (useFavColsSwitcher) {
      useFavColsSwitcher.style.display = state.useBigFavOnly ? 'inline-flex' : 'none';
    }

    const useFavGridEl = document.getElementById('useFavGiantGrid');
    const favCols = state.favCols || 3;
    if (useFavGridEl) {
      useFavGridEl.setAttribute('data-cols', String(favCols));
    }
    document.querySelectorAll('.fav-col-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.getAttribute('data-fav-cols')) === Number(favCols));
    });

    const query = (state.useSearchQuery || '').trim().toLowerCase();

    const favPresets = state.presets.filter((p) => {
      if (!p.isFav) return false;
      if (query) {
        return (
          p.title.toLowerCase().includes(query) ||
          p.fullName.toLowerCase().includes(query) ||
          (p.category || '').toLowerCase().includes(query)
        );
      }
      return true;
    });

    if (useFavGridEl) {
      if (favPresets.length === 0) {
        useFavGridEl.innerHTML = `
          <div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.875rem; font-weight: 700; background: #FFFFFF; border: 1px dashed var(--border-strong); border-radius: 10px;">
            상단의 [★ 품목 선택]을 눌러 자주 쓰는 제품을 등록해 주세요.
          </div>
        `;
      } else {
        useFavGridEl.innerHTML = favPresets
          .map((preset) => {
            const prod = getOrEnsureProductForPreset(preset, false);
            const activeLots = prod.lots
              .filter((l) => l.qty > 0)
              .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
            const totalQty = activeLots.reduce((acc, l) => acc + l.qty, 0);
            const isLowStock = totalQty <= 3;
            const cleanName = preset.title.replace(/\s*\((개봉|소분|제조|해동|당일|세척 후|4H)\)\s*$/, '');

            const stockPillHtml =
              totalQty > 0
                ? `<span class="simple-stock-pill tabular-nums ${isLowStock ? 'low-stock' : ''}">재고 ${totalQty}${prod.unit}</span>`
                : `<span class="simple-stock-pill low-stock tabular-nums">0${prod.unit}</span>`;

            return `
              <div
                class="fav-giant-card ${isLowStock ? 'urgent-stock' : ''}"
                style="border-color: #D97706; cursor: pointer;"
                data-action="use-one-touch"
                data-preset-id="${preset.id}"
                data-qty="1"
                role="button"
                tabindex="0"
              >
                <div class="simple-kiosk-top">
                  <div class="fav-giant-title">${cleanName}</div>
                  <div style="display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;">
                    ${stockPillHtml}
                    <button
                      type="button"
                      class="btn-fav-star is-fav"
                      data-action="toggle-fav-item"
                      data-preset-id="${preset.id}"
                      title="자주 쓰는 품목에서 제외"
                    >★</button>
                  </div>
                </div>

                <div class="use-one-touch-bar tabular-nums">-1</div>
              </div>
            `;
          })
          .join('');
      }
    }

    const filteredPresets = state.presets.filter((preset) => {
      if (query) {
        return (
          preset.title.toLowerCase().includes(query) ||
          preset.fullName.toLowerCase().includes(query) ||
          (preset.category || '').toLowerCase().includes(query) ||
          (preset.note || '').toLowerCase().includes(query)
        );
      }
      if (state.useCategory === 'ALL') return true;
      if (state.useCategory === 'FAV') return Boolean(preset.isFav);
      return preset.category === state.useCategory;
    });

    if (filteredPresets.length === 0) {
      gridEl.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 36px; text-align: center; color: var(--text-muted); font-weight: 700;">
          검색하신 품목이 없습니다.
        </div>
      `;
    } else {
      gridEl.innerHTML = filteredPresets
        .map((preset) => {
          const prod = getOrEnsureProductForPreset(preset, false);
          const activeLots = prod.lots
            .filter((l) => l.qty > 0)
            .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
          const totalQty = activeLots.reduce((acc, l) => acc + l.qty, 0);
          const isLowStock = totalQty <= 3;
          const isFav = Boolean(preset.isFav);
          const cleanName = preset.title.replace(/\s*\((개봉|소분|제조|해동|당일|세척 후|4H)\)\s*$/, '');

          const stockPillHtml =
            totalQty > 0
              ? `<span class="simple-stock-pill tabular-nums ${isLowStock ? 'low-stock' : ''}">재고 ${totalQty}${prod.unit}</span>`
              : `<span class="simple-stock-pill low-stock tabular-nums">0${prod.unit}</span>`;

          return `
            <div
              class="use-kiosk-card ${isLowStock ? 'urgent-stock' : ''}"
              data-action="use-one-touch"
              data-preset-id="${preset.id}"
              data-qty="1"
              role="button"
              tabindex="0"
            >
              <div class="simple-kiosk-top">
                <div class="simple-kiosk-name">${cleanName}</div>
                <div style="display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;">
                  ${stockPillHtml}
                  <button
                    type="button"
                    class="btn-fav-star ${isFav ? 'is-fav' : ''}"
                    data-action="toggle-fav-item"
                    data-preset-id="${preset.id}"
                    title="${isFav ? '자주 쓰는 품목에서 빼기' : '자주 쓰는 품목에 추가'}"
                  >${isFav ? '★' : '☆'}</button>
                </div>
              </div>

              <div class="use-one-touch-bar tabular-nums">-1</div>
            </div>
          `;
        })
        .join('');
    }

    const useHistoryListEl = document.getElementById('useHistoryList');
    const useHistoryBadgeEl = document.getElementById('useHistoryCountBadge');
    const historyArr = state.useHistory || [];

    if (useHistoryBadgeEl) {
      useHistoryBadgeEl.textContent = `${historyArr.length}건 기록됨`;
    }

    if (useHistoryListEl) {
      if (historyArr.length === 0) {
        useHistoryListEl.innerHTML = `
          <div style="padding: 18px 12px; text-align: center; color: var(--text-muted); font-size: 0.8125rem; font-weight: 600;">
            위 품목의 [-1 사용] 버튼을 누르면 재고 차감 내역이 이곳 하단에 실시간 기록됩니다.
          </div>
        `;
      } else {
        useHistoryListEl.innerHTML = historyArr
          .map(
            (h) => `
            <div class="timer-item">
              <div class="timer-item-main">
                <div class="timer-item-title">
                  <span class="dday-badge warning" style="background-color: #FEF3C7; border-color: #F59E0B; color: #92400E;">-${h.qty}${h.unit} 사용</span>
                  <span>${h.itemName}</span>
                </div>
                <div class="timer-item-meta">
                  남은 재고: ${h.remainingQty}${h.unit} · ${h.timeStr}
                </div>
              </div>
              <div class="timer-item-actions">
                <button
                  type="button"
                  class="btn-mini-action dispose-btn"
                  data-action="undo-use"
                  data-history-id="${h.id}"
                >사용취소</button>
              </div>
            </div>
          `
          )
          .join('');
      }
    }
  }

  function renderReceiveModeWorkspace() {
    const gridEl = document.getElementById('receiveKioskGrid');
    if (!gridEl) return;

    const catSelect = document.getElementById('receiveCategorySelect');
    if (catSelect) catSelect.value = state.receiveCategory || 'ALL';

    const query = (state.receiveSearchQuery || '').trim().toLowerCase();
    const filteredPresets = state.presets.filter((preset) => {
      if (query) {
        return (
          preset.title.toLowerCase().includes(query) ||
          preset.fullName.toLowerCase().includes(query) ||
          (preset.category || '').toLowerCase().includes(query) ||
          (preset.note || '').toLowerCase().includes(query)
        );
      }
      if (state.receiveCategory === 'ALL') return true;
      if (state.receiveCategory === 'FAV') return Boolean(preset.isFav);
      return preset.category === state.receiveCategory;
    });

    if (filteredPresets.length === 0) {
      gridEl.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 36px; text-align: center; color: var(--text-muted); font-weight: 700;">
          검색하신 품목이 없습니다.
        </div>
      `;
    } else {
      gridEl.innerHTML = filteredPresets
        .map((preset) => {
          const prod = getOrEnsureProductForPreset(preset, false);
          const activeLots = prod.lots
            .filter((l) => l.qty > 0)
            .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
          const totalQty = activeLots.reduce((acc, l) => acc + l.qty, 0);
          const isLowStock = totalQty <= 3;
          const cleanName = preset.title.replace(/\s*\((개봉|소분|제조|해동|당일|세척 후|4H)\)\s*$/, '');

          const stockPillHtml =
            totalQty > 0
              ? `<span class="simple-stock-pill tabular-nums ${isLowStock ? 'low-stock' : ''}">재고 ${totalQty}${prod.unit}</span>`
              : `<span class="simple-stock-pill low-stock tabular-nums">0${prod.unit}</span>`;

          return `
            <div class="receive-kiosk-card" data-preset-id="${preset.id}">
              <div class="simple-kiosk-top">
                <div class="simple-kiosk-name">${cleanName}</div>
                ${stockPillHtml}
              </div>

              <div class="receive-btn-row">
                <button
                  type="button"
                  class="btn-receive-unit primary-unit tabular-nums"
                  data-action="receive-one-touch"
                  data-preset-id="${preset.id}"
                  data-qty="1"
                >+1</button>
                <button
                  type="button"
                  class="btn-receive-unit tabular-nums"
                  data-action="receive-one-touch"
                  data-preset-id="${preset.id}"
                  data-qty="5"
                >+5</button>
                <button
                  type="button"
                  class="btn-receive-unit tabular-nums"
                  data-action="receive-one-touch"
                  data-preset-id="${preset.id}"
                  data-qty="10"
                >+10</button>
              </div>
            </div>
          `;
        })
        .join('');
    }

    const historyListEl = document.getElementById('receiveHistoryList');
    const historyBadgeEl = document.getElementById('receiveHistoryCountBadge');
    const historyArr = state.receiveHistory || [];

    if (historyBadgeEl) {
      historyBadgeEl.textContent = `${historyArr.length}건 기록됨`;
    }

    if (historyListEl) {
      if (historyArr.length === 0) {
        historyListEl.innerHTML = `
          <div style="padding: 18px 12px; text-align: center; color: var(--text-muted); font-size: 0.8125rem; font-weight: 600;">
            위 품목의 [+1 입고] 버튼을 누르면 입고 내역이 이곳 하단에 실시간 기록됩니다.
          </div>
        `;
      } else {
        historyListEl.innerHTML = historyArr
          .map(
            (h) => `
            <div class="timer-item">
              <div class="timer-item-main">
                <div class="timer-item-title">
                  <span class="dday-badge safe" style="background-color: #E0F2FE; border-color: #7DD3FC; color: #0369A1;">+${h.qty}${h.unit} 입고</span>
                  <span>${h.itemName}</span>
                </div>
                <div class="timer-item-meta">
                  포장기한: ${h.expiryDate} · ${h.timeStr}
                </div>
              </div>
              <div class="timer-item-actions">
                <button
                  type="button"
                  class="btn-mini-action dispose-btn"
                  data-action="undo-receive"
                  data-history-id="${h.id}"
                >입고취소</button>
              </div>
            </div>
          `
          )
          .join('');
      }
    }
  }

  // ==========================================================================
  // 1-D. Daily / Weekly / Monthly Consumption Statistics Dashboard
  // ==========================================================================
  function getSampleBaselineDailyForPreset(preset, dayOffsetFromToday, presetIdx) {
    if (!state.statsIncludeSample) return 0;
    const id = preset.id || '';
    let base = 1;
    if (id.includes('milk')) base = 7;
    else if (id.includes('whip') || id.includes('cream')) base = 5;
    else if (id.includes('sugar') || id.includes('choco')) base = 4;
    else if (id.includes('pearl') || id.includes('blueberry') || id.includes('strawberry')) base = 3;
    else if (preset.isFav) base = 3;
    else if (presetIdx < 16) base = 2;
    else if (presetIdx < 30) base = 1;
    else return 0;

    const wave = ((presetIdx * 3 + dayOffsetFromToday * 5) % 3) - 1;
    return Math.max(0, base + wave);
  }

  function renderStatsModeWorkspace() {
    const barChartEl = document.getElementById('statsBarChartContainer');
    const rankingListEl = document.getElementById('statsRankingList');
    if (!barChartEl || !rankingListEl) return;

    const period = state.statsPeriod || 'DAILY';
    document.querySelectorAll('.stats-period-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-stats-period') === period);
    });

    const chkSampleEl = document.getElementById('chkStatsSampleData');
    if (chkSampleEl) {
      chkSampleEl.checked = Boolean(state.statsIncludeSample);
    }

    // Sync Category Select & Item Select in Stats Toolbar
    const catSelectEl = document.getElementById('statsCategorySelect');
    const itemSelectEl = document.getElementById('statsItemSelect');
    const categories = [];
    state.presets.forEach((p) => {
      const c = (p.category || '기타 자재').trim();
      if (c && !categories.includes(c)) categories.push(c);
    });

    if (catSelectEl) {
      const prevCat = state.statsCategory || 'ALL';
      catSelectEl.innerHTML = [
        `<option value="ALL">전체 분류 (${state.presets.length}종)</option>`,
        ...categories.map((c) => `<option value="${c}">${c}</option>`)
      ].join('');
      if (prevCat !== 'ALL' && !categories.includes(prevCat)) {
        state.statsCategory = 'ALL';
      }
      catSelectEl.value = state.statsCategory || 'ALL';
    }

    const catFilteredPresets = state.presets.filter((p) => {
      if (!state.statsCategory || state.statsCategory === 'ALL') return true;
      return (p.category || '기타 자재').trim() === state.statsCategory;
    });

    if (itemSelectEl) {
      const prevItem = state.statsItemId || 'ALL';
      itemSelectEl.innerHTML = [
        `<option value="ALL">전체 자재 합산 보기 (${catFilteredPresets.length}종)</option>`,
        ...catFilteredPresets.map((p) => {
          const clean = p.title.replace(/\s*\((개봉|소분|제조|해동|당일|세척 후|4H)\)\s*$/, '');
          return `<option value="${p.id}">${clean}</option>`;
        })
      ].join('');
      if (prevItem !== 'ALL' && !catFilteredPresets.some((p) => p.id === prevItem)) {
        state.statsItemId = 'ALL';
      }
      itemSelectEl.value = state.statsItemId || 'ALL';
    }

    const resetBtn = document.getElementById('btnStatsResetItemFilter');
    if (resetBtn) {
      resetBtn.style.display = state.statsItemId && state.statsItemId !== 'ALL' ? 'inline-flex' : 'none';
    }

    const targetPresets =
      state.statsItemId && state.statsItemId !== 'ALL'
        ? catFilteredPresets.filter((p) => p.id === state.statsItemId)
        : catFilteredPresets;

    const singleUnitLabel =
      targetPresets.length === 1
        ? getOrEnsureProductForPreset(targetPresets[0], false).unit || '개'
        : '개';

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayMs = 86400000;
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const useHistory = Array.isArray(state.useHistory) ? state.useHistory : [];

    function getActualUsedBetween(presetIdSet, startMs, endMs) {
      let sum = 0;
      for (let i = 0; i < useHistory.length; i += 1) {
        const h = useHistory[i];
        if (!presetIdSet.has(h.presetId)) continue;
        let ts = Number(h.timestampMs || 0);
        if (!ts && h.dateStr) {
          ts = new Date(`${h.dateStr}T12:00:00`).getTime();
        }
        if (!ts) ts = todayMidnight + 3600000;
        if (ts >= startMs && ts < endMs) {
          sum += Number(h.qty || 1);
        }
      }
      return sum;
    }

    const targetPresetIdSet = new Set(targetPresets.map((p) => p.id));

    // Calculate KPI Cards (Today / This Week / This Month)
    const todayActual = getActualUsedBetween(targetPresetIdSet, todayMidnight, todayMidnight + dayMs);
    const yesterdayActual = getActualUsedBetween(targetPresetIdSet, todayMidnight - dayMs, todayMidnight);
    let todaySample = 0;
    let yesterdaySample = 0;
    targetPresets.forEach((p) => {
      const idx = state.presets.findIndex((x) => x.id === p.id);
      todaySample += getSampleBaselineDailyForPreset(p, 0, Math.max(0, idx));
      yesterdaySample += getSampleBaselineDailyForPreset(p, 1, Math.max(0, idx));
    });
    const todayTotal = todaySample + todayActual;
    const yesterdayTotal = yesterdaySample + yesterdayActual;

    const weekStartMs = todayMidnight - 6 * dayMs;
    const prevWeekStartMs = weekStartMs - 7 * dayMs;
    const thisWeekActual = getActualUsedBetween(targetPresetIdSet, weekStartMs, todayMidnight + dayMs);
    const prevWeekActual = getActualUsedBetween(targetPresetIdSet, prevWeekStartMs, weekStartMs);
    let thisWeekSample = 0;
    let prevWeekSample = 0;
    for (let d = 0; d < 7; d += 1) {
      targetPresets.forEach((p) => {
        const idx = state.presets.findIndex((x) => x.id === p.id);
        thisWeekSample += getSampleBaselineDailyForPreset(p, d, Math.max(0, idx));
        prevWeekSample += getSampleBaselineDailyForPreset(p, d + 7, Math.max(0, idx));
      });
    }
    const thisWeekTotal = thisWeekSample + thisWeekActual;
    const prevWeekTotal = prevWeekSample + prevWeekActual;

    const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const prevMonthStartMs = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    const thisMonthActual = getActualUsedBetween(targetPresetIdSet, monthStartMs, todayMidnight + dayMs);
    const prevMonthActual = getActualUsedBetween(targetPresetIdSet, prevMonthStartMs, monthStartMs);
    const thisMonthSample = thisWeekSample * 4;
    const prevMonthSample = prevWeekSample * 4;
    const thisMonthTotal = thisMonthSample + thisMonthActual;
    const prevMonthTotal = prevMonthSample + prevMonthActual;

    const kpiTodayValEl = document.getElementById('statsKpiTodayVal');
    const kpiTodaySubEl = document.getElementById('statsKpiTodaySub');
    const kpiWeekValEl = document.getElementById('statsKpiWeekVal');
    const kpiWeekSubEl = document.getElementById('statsKpiWeekSub');
    const kpiMonthValEl = document.getElementById('statsKpiMonthVal');
    const kpiMonthSubEl = document.getElementById('statsKpiMonthSub');

    if (kpiTodayValEl) kpiTodayValEl.textContent = `${todayTotal.toLocaleString('ko-KR')}${singleUnitLabel}`;
    if (kpiTodaySubEl) {
      const diff = todayTotal - yesterdayTotal;
      kpiTodaySubEl.textContent = `어제(${yesterdayTotal}${singleUnitLabel}) 대비 ${diff >= 0 ? '+' + diff : diff}${singleUnitLabel}`;
    }
    if (kpiWeekValEl) kpiWeekValEl.textContent = `${thisWeekTotal.toLocaleString('ko-KR')}${singleUnitLabel}`;
    if (kpiWeekSubEl) {
      const diff = thisWeekTotal - prevWeekTotal;
      kpiWeekSubEl.textContent = `지난주(${prevWeekTotal}${singleUnitLabel}) 대비 ${diff >= 0 ? '+' + diff : diff}${singleUnitLabel}`;
    }
    if (kpiMonthValEl) kpiMonthValEl.textContent = `${thisMonthTotal.toLocaleString('ko-KR')}${singleUnitLabel}`;
    if (kpiMonthSubEl) {
      const diff = thisMonthTotal - prevMonthTotal;
      kpiMonthSubEl.textContent = `전월(${prevMonthTotal}${singleUnitLabel}) 대비 ${diff >= 0 ? '+' + diff : diff}${singleUnitLabel}`;
    }

    // Build Trend Buckets for Selected Period (DAILY / WEEKLY / MONTHLY)
    const buckets = [];
    if (period === 'DAILY') {
      for (let i = 6; i >= 0; i -= 1) {
        const dStart = todayMidnight - i * dayMs;
        const dEnd = dStart + dayMs;
        const dObj = new Date(dStart);
        const m = dObj.getMonth() + 1;
        const day = dObj.getDate();
        const dow = dayNames[dObj.getDay()];
        const actual = getActualUsedBetween(targetPresetIdSet, dStart, dEnd);
        let sample = 0;
        targetPresets.forEach((p) => {
          const idx = state.presets.findIndex((x) => x.id === p.id);
          sample += getSampleBaselineDailyForPreset(p, i, Math.max(0, idx));
        });
        buckets.push({
          label: i === 0 ? `오늘(${m}/${day})` : `${m}/${day}(${dow})`,
          value: sample + actual,
          isCurrent: i === 0
        });
      }
    } else if (period === 'WEEKLY') {
      for (let w = 7; w >= 0; w -= 1) {
        const wEnd = todayMidnight + dayMs - w * 7 * dayMs;
        const wStart = wEnd - 7 * dayMs;
        const startObj = new Date(wStart);
        const m = startObj.getMonth() + 1;
        const d = startObj.getDate();
        const actual = getActualUsedBetween(targetPresetIdSet, wStart, wEnd);
        let sample = 0;
        for (let dayOffset = w * 7; dayOffset < (w + 1) * 7; dayOffset += 1) {
          targetPresets.forEach((p) => {
            const idx = state.presets.findIndex((x) => x.id === p.id);
            sample += getSampleBaselineDailyForPreset(p, dayOffset, Math.max(0, idx));
          });
        }
        buckets.push({
          label: w === 0 ? '이번 주' : w === 1 ? '지난주' : `${w}주 전(${m}/${d}~)`,
          value: sample + actual,
          isCurrent: w === 0
        });
      }
    } else {
      for (let mOffset = 5; mOffset >= 0; mOffset -= 1) {
        const mStartObj = new Date(now.getFullYear(), now.getMonth() - mOffset, 1);
        const mEndObj = new Date(now.getFullYear(), now.getMonth() - mOffset + 1, 1);
        const mNum = mStartObj.getMonth() + 1;
        const actual = getActualUsedBetween(targetPresetIdSet, mStartObj.getTime(), mEndObj.getTime());
        let sample = 0;
        targetPresets.forEach((p) => {
          const idx = state.presets.findIndex((x) => x.id === p.id);
          const dailyAvg = getSampleBaselineDailyForPreset(p, mOffset, Math.max(0, idx));
          sample += dailyAvg * (28 + (mOffset % 3));
        });
        buckets.push({
          label: mOffset === 0 ? `${mNum}월 (이번달)` : `${mNum}월`,
          value: sample + actual,
          isCurrent: mOffset === 0
        });
      }
    }

    const chartTitleEl = document.getElementById('statsTrendChartTitle');
    const totalBadgeEl = document.getElementById('statsTrendTotalBadge');
    const selectedPresetObj =
      state.statsItemId && state.statsItemId !== 'ALL'
        ? state.presets.find((p) => p.id === state.statsItemId)
        : null;
    const itemPrefix = selectedPresetObj
      ? `[${selectedPresetObj.title.replace(/\s*\((개봉|소분|제조|해동|당일|세척 후|4H)\)\s*$/, '')}] `
      : '';

    if (chartTitleEl) {
      if (period === 'DAILY') chartTitleEl.textContent = `${itemPrefix}일별 소비량 추이 그래프 (최근 7일)`;
      else if (period === 'WEEKLY') chartTitleEl.textContent = `${itemPrefix}주별 소비량 추이 그래프 (최근 8주)`;
      else chartTitleEl.textContent = `${itemPrefix}월별 소비량 추이 그래프 (최근 6개월)`;
    }

    const totalBucketSum = buckets.reduce((acc, b) => acc + b.value, 0);
    if (totalBadgeEl) {
      totalBadgeEl.textContent = `기간 총 소비: ${totalBucketSum.toLocaleString('ko-KR')}${singleUnitLabel}`;
    }

    const maxVal = Math.max(1, ...buckets.map((b) => b.value));
    barChartEl.innerHTML = buckets
      .map((b) => {
        const heightPct = Math.max(6, Math.round((b.value / maxVal) * 100));
        return `
          <div class="stats-bar-col ${b.isCurrent ? 'is-current' : ''}">
            <div class="stats-bar-track">
              <span class="stats-bar-val tabular-nums">${b.value.toLocaleString('ko-KR')}${singleUnitLabel}</span>
              <div class="stats-bar-fill" style="height: ${heightPct}%;"></div>
            </div>
            <div class="stats-bar-label">${b.label}</div>
          </div>
        `;
      })
      .join('');

    // Build Top 10 Consumed Items Ranking for Selected Period
    const periodDaysCount = period === 'DAILY' ? 7 : period === 'WEEKLY' ? 56 : 180;
    const periodStartMs = todayMidnight - (periodDaysCount - 1) * dayMs;

    const itemRanks = catFilteredPresets
      .map((p) => {
        const idx = state.presets.findIndex((x) => x.id === p.id);
        const prod = getOrEnsureProductForPreset(p, false);
        const cleanName = p.title.replace(/\s*\((개봉|소분|제조|해동|당일|세척 후|4H)\)\s*$/, '');
        const singleSet = new Set([p.id]);
        const actual = getActualUsedBetween(singleSet, periodStartMs, todayMidnight + dayMs);

        let sample = 0;
        if (period === 'DAILY') {
          for (let d = 0; d < 7; d += 1) {
            sample += getSampleBaselineDailyForPreset(p, d, Math.max(0, idx));
          }
        } else if (period === 'WEEKLY') {
          for (let d = 0; d < 7; d += 1) {
            sample += getSampleBaselineDailyForPreset(p, d, Math.max(0, idx)) * 8;
          }
        } else {
          for (let d = 0; d < 7; d += 1) {
            sample += getSampleBaselineDailyForPreset(p, d, Math.max(0, idx)) * 25;
          }
        }

        return {
          presetId: p.id,
          name: cleanName,
          unit: prod.unit || '개',
          qty: sample + actual
        };
      })
      .filter((r) => r.qty > 0)
      .sort((a, b) => b.qty - a.qty);

    const kpiTopItemValEl = document.getElementById('statsKpiTopItemVal');
    const kpiTopItemSubEl = document.getElementById('statsKpiTopItemSub');
    if (itemRanks.length > 0) {
      const top1 = itemRanks[0];
      if (kpiTopItemValEl) kpiTopItemValEl.textContent = top1.name;
      if (kpiTopItemSubEl) kpiTopItemSubEl.textContent = `기간 내 총 ${top1.qty.toLocaleString('ko-KR')}${top1.unit} 소비 (1위)`;
    } else {
      if (kpiTopItemValEl) kpiTopItemValEl.textContent = '기록 없음';
      if (kpiTopItemSubEl) kpiTopItemSubEl.textContent = '[사용 차감 (-1)] 시 자동 집계';
    }

    const top10 = itemRanks.slice(0, 10);
    const maxRankQty = Math.max(1, top10[0]?.qty || 1);
    const totalAllRankQty = Math.max(1, itemRanks.reduce((acc, r) => acc + r.qty, 0));

    if (top10.length === 0) {
      rankingListEl.innerHTML = `
        <div style="padding: 28px 12px; text-align: center; color: var(--text-muted); font-size: 0.8125rem; font-weight: 700;">
          표시할 소비 내역이 없습니다. [사용 차감 (-재고)] 화면에서 품목을 차감하거나 상단 [예시 추이 포함]을 켜주세요.
        </div>
      `;
    } else {
      rankingListEl.innerHTML = top10
        .map((item, idx) => {
          const widthPct = Math.max(8, Math.round((item.qty / maxRankQty) * 100));
          const sharePct = Math.round((item.qty / totalAllRankQty) * 100);
          const isSelected = state.statsItemId === item.presetId;
          return `
            <div
              class="stats-rank-row ${idx < 3 ? 'top-rank' : ''} ${isSelected ? 'selected' : ''}"
              data-action="select-stats-item"
              data-preset-id="${item.presetId}"
              title="클릭하여 [${item.name}] 품목 단독 추이 그래프 보기"
            >
              <div class="stats-rank-top">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                  <span class="stats-rank-badge tabular-nums">${idx + 1}</span>
                  <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.name}</span>
                </div>
                <span class="tabular-nums" style="color: #3730A3; flex-shrink: 0;">
                  ${item.qty.toLocaleString('ko-KR')}${item.unit} <small style="color: var(--text-muted);">(${sharePct}%)</small>
                </span>
              </div>
              <div class="stats-rank-bar-bg">
                <div class="stats-rank-bar-fill" style="width: ${widthPct}%;"></div>
              </div>
            </div>
          `;
        })
        .join('');
    }
  }

  function setAppMode(mode) {
    if (mode !== 'SIMPLE' && !isFullLicense()) {
      const modeName =
        mode === 'USE'
          ? '사용 차감 (-재고)'
          : mode === 'RECEIVE'
          ? '원터치 입고 (+재고)'
          : mode === 'STATS'
          ? '일별·주별·월별 사용량 통계'
          : '상세 재고·로트 관리';
      openLicenseModal(`🔒 [${modeName}] 기능은 30,000원 정식판(평생 소장권) 전용 기능입니다.`);
      return;
    }

    if (mode === 'USE') state.appMode = 'USE';
    else if (mode === 'RECEIVE') state.appMode = 'RECEIVE';
    else if (mode === 'STATS') state.appMode = 'STATS';
    else if (mode === 'PRO') state.appMode = 'PRO';
    else state.appMode = 'SIMPLE';

    saveState();

    const appShell = document.querySelector('.app-shell');
    if (appShell) {
      appShell.setAttribute('data-app-mode', state.appMode);
    }

    const btnSimple = document.getElementById('btnModeSimple');
    const btnUse = document.getElementById('btnModeUse');
    const btnReceive = document.getElementById('btnModeReceive');
    const btnStats = document.getElementById('btnModeStats');
    const btnPro = document.getElementById('btnModePro');
    if (btnSimple) btnSimple.classList.toggle('active', state.appMode === 'SIMPLE');
    if (btnUse) btnUse.classList.toggle('active', state.appMode === 'USE');
    if (btnReceive) btnReceive.classList.toggle('active', state.appMode === 'RECEIVE');
    if (btnStats) btnStats.classList.toggle('active', state.appMode === 'STATS');
    if (btnPro) btnPro.classList.toggle('active', state.appMode === 'PRO');

    renderSimpleModeWorkspace();
    renderUseModeWorkspace();
    renderReceiveModeWorkspace();
    renderStatsModeWorkspace();
  }

  function renderCurrentSticker() {
    const label = state.lastPrintedLabel;
    if (!label) return;

    const activePreset =
      state.presets.find((p) => p.id === label.presetId) ||
      state.presets.find((p) => p.fullName === label.itemName) ||
      state.presets[0];

    const origExpiry =
      label.originalExpiryFormatted ||
      getOriginalExpiryFormattedForPreset(activePreset);
    label.originalExpiryFormatted = origExpiry;

    const actionText = `[${label.actionType || '소분/개봉'}]`;
    const storageShort = (label.storageMethod || '냉장').split(' ')[0];
    const expiresClean = (label.expiresAtFormatted || '')
      .replace(/\s*\(당일포함[^)]*\)/g, '')
      .replace(/\s*까지$/g, '')
      .trim();
    const currentStaffName = (state.currentStaff || '매장관리자').trim();
    label.manager = currentStaffName;
    const managerText = `${currentStaffName} (${label.code || '#L-100'})`;

    const paperSize = state.labelPaperSize || '58x40';
    const isLargeFont = Boolean(state.labelLargeFont);
    const showOrigExpiry = state.labelShowOrigExpiry !== false;
    const showManager = state.labelShowManager !== false;
    printer.paperSize = paperSize;

    // Sync Customizer UI Controls
    const mgrInput = document.getElementById('labelManagerNameInput');
    if (mgrInput && document.activeElement !== mgrInput) {
      mgrInput.value = currentStaffName;
    }
    const quickPaperSelect = document.getElementById('quickPaperSizeSelect');
    if (quickPaperSelect) quickPaperSelect.value = paperSize;
    const modalPaperSelect = document.getElementById('printerPaperSizeSelect');
    if (modalPaperSelect) modalPaperSelect.value = paperSize;
    const chkLargeEl = document.getElementById('chkLargeLabelFont');
    if (chkLargeEl) chkLargeEl.checked = isLargeFont;
    const chkOrigEl = document.getElementById('chkShowOrigExpiry');
    if (chkOrigEl) chkOrigEl.checked = showOrigExpiry;
    const chkMgrEl = document.getElementById('chkShowManager');
    if (chkMgrEl) chkMgrEl.checked = showManager;

    // 1. Pro Mode Sticker
    const actionEl = document.getElementById('stickerActionType');
    if (actionEl) actionEl.textContent = actionText;
    document.getElementById('stickerStorage').textContent = storageShort;
    document.getElementById('stickerItemName').textContent = label.itemName;
    const pOrigEl = document.getElementById('stickerOriginalExpiry');
    if (pOrigEl) pOrigEl.textContent = origExpiry;
    document.getElementById('stickerOpenedAt').textContent = label.openedAtFormatted;
    document.getElementById('stickerExpiresAt').textContent = expiresClean;

    const mgrEl = document.getElementById('stickerManager');
    if (mgrEl) mgrEl.textContent = managerText;
    const pOrigRow = document.getElementById('stickerOrigRow');
    if (pOrigRow) pOrigRow.style.display = showOrigExpiry ? 'grid' : 'none';
    const pMgrRow = document.getElementById('stickerManagerRow');
    if (pMgrRow) pMgrRow.style.display = showManager ? 'grid' : 'none';

    const paperEl = document.getElementById('printableLabelArea');
    if (paperEl) {
      paperEl.setAttribute('data-paper-size', paperSize);
      paperEl.classList.toggle('is-large-font', isLargeFont);
      paperEl.classList.remove('printing-anim');
      void paperEl.offsetWidth;
      paperEl.classList.add('printing-anim');
    }

    // 2. Simple Mode Giant Sticker
    const sCode = document.getElementById('simpleStickerCode');
    const sAction = document.getElementById('simpleStickerAction');
    const sStorage = document.getElementById('simpleStickerStorage');
    const sName = document.getElementById('simpleStickerName');
    const sOrig = document.getElementById('simpleStickerOriginalExpiry');
    const sOpened = document.getElementById('simpleStickerOpened');
    const sExpires = document.getElementById('simpleStickerExpires');
    const sMgr = document.getElementById('simpleStickerManager');
    const sOrigRow = document.getElementById('simpleStickerOrigRow');
    const sMgrRow = document.getElementById('simpleStickerManagerRow');
    const sPaper = document.getElementById('simpleStickerPaper');

    if (sCode) sCode.textContent = label.code;
    if (sAction) sAction.textContent = actionText;
    if (sStorage) sStorage.textContent = storageShort;
    if (sName) sName.textContent = label.itemName;
    if (sOrig) sOrig.textContent = origExpiry;
    if (sOpened) sOpened.textContent = label.openedAtFormatted;
    if (sExpires) sExpires.textContent = expiresClean;
    if (sMgr) sMgr.textContent = managerText;
    if (sOrigRow) sOrigRow.style.display = showOrigExpiry ? 'grid' : 'none';
    if (sMgrRow) sMgrRow.style.display = showManager ? 'grid' : 'none';

    if (sPaper) {
      sPaper.setAttribute('data-paper-size', paperSize);
      sPaper.classList.toggle('is-large-font', isLargeFont);
      sPaper.classList.remove('printing-anim');
      void sPaper.offsetWidth;
      sPaper.classList.add('printing-anim');
    }
  }

  function renderActiveTimersAndBottomBar() {
    const timersListEl = document.getElementById('activeTimersList');
    const simpleTimersListEl = document.getElementById('simpleSavedContainersList');
    const countBadgeEl = document.getElementById('activeTimerCountBadge');
    const simpleCountBadgeEl = document.getElementById('simpleSavedCountBadge');

    if (countBadgeEl) {
      countBadgeEl.textContent = `${state.activeTimers.length}건 관리 중`;
    }
    if (simpleCountBadgeEl) {
      simpleCountBadgeEl.textContent = `${state.activeTimers.length}건 개별 보관 중`;
    }

    let timersHtml = '';
    if (state.activeTimers.length === 0) {
      timersHtml = `
        <div style="padding: 24px 12px; text-align: center; color: var(--text-muted); font-size: 0.8125rem; font-weight: 600;">
          현재 개봉·소분 중인 용기가 없습니다.
        </div>
      `;
    } else {
      const sortedTimers = [...state.activeTimers].sort((a, b) => {
        const da = a.isClosingTarget ? -1 : calcDDay(a.expiresDateStr);
        const db = b.isClosingTarget ? -1 : calcDDay(b.expiresDateStr);
        return da - db;
      });

      timersHtml = sortedTimers
        .map((t) => {
          const dDay = calcDDay(t.expiresDateStr);
          const isUrgent = t.isClosingTarget || dDay <= 0;
          const dBadge = isUrgent
            ? `<span class="dday-badge danger">오늘 마감폐기</span>`
            : `<span class="dday-badge safe">D-${dDay} 남음</span>`;

          return `
            <div class="timer-item ${isUrgent ? 'urgent-timer' : ''}">
              <div class="timer-item-main">
                <div class="timer-item-title">
                  ${dBadge}
                  <span>${t.itemName}</span>
                </div>
                <div class="timer-item-meta">
                  만료: ${t.expiresAtFormatted} · ${t.storageMethod || '냉장'} (${t.code})
                </div>
              </div>
              <div class="timer-item-actions">
                <button
                  type="button"
                  class="btn-mini-action"
                  data-action="consume-timer"
                  data-timer-id="${t.id}"
                >소진</button>
                <button
                  type="button"
                  class="btn-mini-action dispose-btn"
                  data-action="dispose-timer"
                  data-timer-id="${t.id}"
                >폐기완료</button>
              </div>
            </div>
          `;
        })
        .join('');
    }

    if (timersListEl) timersListEl.innerHTML = timersHtml;
    if (simpleTimersListEl) simpleTimersListEl.innerHTML = timersHtml;

    const closingTargets = state.activeTimers.filter(
      (t) => t.isClosingTarget || calcDDay(t.expiresDateStr) <= 0
    );
    const bottomBar = document.getElementById('bottomAlertBar');
    const badgeEl = document.getElementById('closingStatusBadge');
    const titleEl = document.getElementById('closingAlertTitle');
    const chipsEl = document.getElementById('closingAlertChips');
    const disposeAllBtn = document.getElementById('btnDisposeAllClosing');
    const roiEl = document.getElementById('roiSavedAmount');
    const toggleAlertBtn = document.getElementById('btnToggleAlertBar');

    if (bottomBar) {
      bottomBar.classList.toggle('is-collapsed', Boolean(state.alertBarCollapsed));
    }
    if (toggleAlertBtn) {
      toggleAlertBtn.textContent = state.alertBarCollapsed ? '▼ 펼치기' : '▲ 접기';
      toggleAlertBtn.setAttribute('aria-expanded', String(!state.alertBarCollapsed));
    }

    const navBadgeTimers = document.getElementById('navBadgeTimers');
    const badgeCountVal = closingTargets.length > 0 ? closingTargets.length : state.activeTimers.length;
    if (navBadgeTimers) {
      navBadgeTimers.textContent = String(badgeCountVal);
      navBadgeTimers.classList.toggle('urgent', closingTargets.length > 0);
    }

    if (roiEl) {
      roiEl.textContent = `${state.roiSavedKrw.toLocaleString('ko-KR')}원`;
    }

    if (closingTargets.length === 0) {
      bottomBar.classList.add('all-clear');
      badgeEl.className = 'alert-badge-clear';
      titleEl.textContent = '오늘 밤 마감 폐기 대상: 0건 (위생점검 완벽 클리어)';
      chipsEl.innerHTML = `<span style="font-size: 0.8125rem; color: #A7F3D0; font-weight: 700;">모든 개봉·소분 자재가 당일포함 안전보관일 이내로 관리되고 있습니다.</span>`;
      disposeAllBtn.style.display = 'none';
    } else {
      bottomBar.classList.remove('all-clear');
      badgeEl.className = 'alert-badge-urgent';
      titleEl.textContent = `오늘 밤 마감 폐기 대상: ${closingTargets.length}건 (위생 체크 필요)`;
      disposeAllBtn.style.display = 'inline-flex';
      chipsEl.innerHTML = closingTargets
        .map(
          (t) => `
          <div class="disposal-chip">
            <span>${t.itemName}</span>
            <button
              type="button"
              class="disposal-chip-btn"
              data-action="dispose-timer"
              data-timer-id="${t.id}"
            >폐기 완료</button>
          </div>
        `
        )
        .join('');
    }
  }

  function renderSlipDraftTable() {
    const tbody = document.getElementById('slipItemsTableBody');
    if (!tbody) return;

    tbody.innerHTML = currentSlipDraftRows
      .map(
        (row, index) => `
        <tr>
          <td>
            <input type="text" value="${row.name}" data-slip-row="${index}" data-field="name" placeholder="품목명" />
          </td>
          <td>
            <input type="date" class="tabular-nums" value="${row.expiryDate}" data-slip-row="${index}" data-field="expiryDate" />
          </td>
          <td>
            <input type="number" class="tabular-nums" min="1" max="500" value="${row.qty}" data-slip-row="${index}" data-field="qty" />
          </td>
          <td>
            <select data-slip-row="${index}" data-field="zone">
              <option value="우유·유제품 냉장" ${row.zone === '우유·유제품 냉장' ? 'selected' : ''}>우유·유제품 냉장</option>
              <option value="시럽·소스·베이스 냉장" ${row.zone === '시럽·소스·베이스 냉장' ? 'selected' : ''}>시럽·소스·베이스 냉장</option>
              <option value="베이커리·과일 쇼케이스" ${row.zone === '베이커리·과일 쇼케이스' ? 'selected' : ''}>베이커리·과일 쇼케이스</option>
              <option value="커피바·파우더·실온" ${row.zone === '커피바·파우더·실온' ? 'selected' : ''}>커피바·파우더·실온</option>
            </select>
          </td>
        </tr>
      `
      )
      .join('');
  }

  function renderSlipArchiveGrid() {
    const grid = document.getElementById('slipArchiveGrid');
    if (!grid) return;
    renderSlipCountBadges();

    if (!state.deliverySlips || state.deliverySlips.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 36px; text-align: center; color: var(--text-muted); font-weight: 600;">
          보관된 입고리스트(거래명세서) 사진이 없습니다.
        </div>
      `;
      return;
    }

    grid.innerHTML = state.deliverySlips
      .map((slip) => {
        const itemsTags = (slip.items || [])
          .map((i) => `<span class="slip-item-pill">${i.name} (${i.qty}개 · ${formatShortDate(i.expiryDate)})</span>`)
          .join('');

        return `
          <div class="slip-archive-card">
            <img
              src="${slip.photoUrl}"
              alt="${slip.supplier}"
              class="slip-archive-img"
              data-action="zoom-slip-photo"
              data-slip-id="${slip.id}"
              title="클릭하여 거래명세서 사진 원본 크게 보기"
            />
            <div class="slip-archive-info">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                <span class="slip-archive-title">${slip.supplier}</span>
                <button type="button" class="btn-mini-action dispose-btn" data-action="delete-slip" data-slip-id="${slip.id}" style="height: 24px; padding: 0 7px;">삭제</button>
              </div>
              <span class="slip-archive-meta tabular-nums">촬영일시: ${slip.capturedAt}</span>
              <div class="slip-archive-tags">
                ${itemsTags || '<span class="slip-item-pill">사진 단독 보관</span>'}
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function setMobileTab(tabName) {
    if (tabName === 'slips') {
      const openSlipBtn = document.getElementById('btnOpenSlipModal');
      if (openSlipBtn) openSlipBtn.click();
      return;
    }

    if (tabName === 'simple') {
      setAppMode('SIMPLE');
    } else if (tabName === 'use') {
      setAppMode('USE');
    } else if (tabName === 'receive') {
      setAppMode('RECEIVE');
    } else if (tabName === 'stats') {
      setAppMode('STATS');
    } else {
      setAppMode('PRO');
    }

    const appShell = document.querySelector('.app-shell');
    const workspace = document.getElementById('mainDualWorkspace');
    if (appShell) appShell.setAttribute('data-active-mobile-tab', tabName);
    if (workspace) workspace.setAttribute('data-active-mobile-tab', tabName);

    document.querySelectorAll('[data-mobile-tab]').forEach((btn) => {
      const btnTab = btn.getAttribute('data-mobile-tab');
      btn.classList.toggle('active', btnTab === tabName);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderAll() {
    const appShell = document.querySelector('.app-shell');
    if (appShell) {
      appShell.setAttribute('data-app-mode', state.appMode || 'SIMPLE');
    }
    const btnSimple = document.getElementById('btnModeSimple');
    const btnUse = document.getElementById('btnModeUse');
    const btnReceive = document.getElementById('btnModeReceive');
    const btnStats = document.getElementById('btnModeStats');
    const btnPro = document.getElementById('btnModePro');
    if (btnSimple) btnSimple.classList.toggle('active', (state.appMode || 'SIMPLE') === 'SIMPLE');
    if (btnUse) btnUse.classList.toggle('active', state.appMode === 'USE');
    if (btnReceive) btnReceive.classList.toggle('active', state.appMode === 'RECEIVE');
    if (btnStats) btnStats.classList.toggle('active', state.appMode === 'STATS');
    if (btnPro) btnPro.classList.toggle('active', state.appMode === 'PRO');

    renderClock();
    renderStaffButtons();
    renderSlipCountBadges();
    syncCategoryDropdowns();
    renderSimpleModeWorkspace();
    renderUseModeWorkspace();
    renderReceiveModeWorkspace();
    renderStatsModeWorkspace();
    renderFifoInventory();
    renderPresetGrid();
    renderActiveTimersAndBottomBar();
    renderGoogleSyncStatus();
    renderLicenseStatus();
  }

  // ==========================================================================
  // Core Actions: Print Preset Label (당일 포함 날짜 계산) & Open Unopened Pack
  // ==========================================================================

  function executeQuickUseStock(presetId, deductQty = 1) {
    const preset = state.presets.find((p) => p.id === presetId);
    if (!preset) return;

    const reqQty = Math.max(1, Number(deductQty) || 1);
    const prod = getOrEnsureProductForPreset(preset, true);
    const activeLots = prod.lots
      .filter((l) => l.qty > 0)
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

    const cleanName = preset.title.replace(/\s*\((개봉|소분|제조|해동|당일|세척 후|4H)\)\s*$/, '');
    let remainingToDeduct = reqQty;
    let actualDeducted = 0;
    const deductedFromLots = [];

    for (let i = 0; i < activeLots.length && remainingToDeduct > 0; i += 1) {
      const lot = activeLots[i];
      const take = Math.min(lot.qty, remainingToDeduct);
      if (take > 0) {
        lot.qty -= take;
        remainingToDeduct -= take;
        actualDeducted += take;
        deductedFromLots.push({ expiryDate: lot.expiryDate, qty: take });
      }
    }

    const remainingQty = prod.lots
      .filter((l) => l.qty > 0)
      .reduce((acc, l) => acc + l.qty, 0);

    let feedbackTitle = '';
    let feedbackSub = '';

    if (actualDeducted > 0) {
      state.roiSavedKrw += actualDeducted * 3500;
      if (!Array.isArray(state.useHistory)) state.useHistory = [];
      const nowObj = new Date();
      state.useHistory.unshift({
        id: `use-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        presetId: preset.id,
        productId: prod.id,
        itemName: cleanName,
        qty: actualDeducted,
        unit: prod.unit,
        remainingQty,
        deductedFromLots,
        timestampMs: nowObj.getTime(),
        dateStr: addDaysToDateStr(nowObj, 0),
        timeStr: formatDateTime(nowObj)
      });

      feedbackTitle = `[${cleanName}] -${actualDeducted}${prod.unit} 사용 차감 완료! (남은 재고 ${remainingQty}${prod.unit})`;
      feedbackSub = `라벨 출력 없이 재고만 차감되었습니다 · 하단 사용 내역에서 취소 가능`;
    } else {
      feedbackTitle = `[${cleanName}] 현재 재고 0${prod.unit} (차감 불가)`;
      feedbackSub = `[원터치 입고 (+재고)] 화면에서 먼저 재고를 추가해 주세요`;
    }

    const uTitleEl = document.getElementById('useFeedbackTitle');
    const uSubEl = document.getElementById('useFeedbackSub');
    if (uTitleEl) uTitleEl.textContent = feedbackTitle;
    if (uSubEl) uSubEl.textContent = feedbackSub;

    saveState();
    renderUseModeWorkspace();
    renderReceiveModeWorkspace();
    renderStatsModeWorkspace();
    renderFifoInventory();
  }

  function undoUseHistory(historyId) {
    if (!Array.isArray(state.useHistory)) return;
    const idx = state.useHistory.findIndex((h) => h.id === historyId);
    if (idx === -1) return;

    const entry = state.useHistory[idx];
    const prod =
      state.unopenedProducts.find((p) => p.id === entry.productId) ||
      state.unopenedProducts.find((p) => p.linkedPresetId === entry.presetId);

    if (prod) {
      if (Array.isArray(entry.deductedFromLots) && entry.deductedFromLots.length > 0) {
        entry.deductedFromLots.forEach((lotInfo) => {
          const existingLot = prod.lots.find((l) => l.expiryDate === lotInfo.expiryDate);
          if (existingLot) {
            existingLot.qty += lotInfo.qty;
          } else {
            prod.lots.push({
              id: `lot-restore-${Date.now()}`,
              expiryDate: lotInfo.expiryDate,
              qty: lotInfo.qty
            });
          }
        });
      } else if (prod.lots.length > 0) {
        prod.lots[0].qty += entry.qty;
      }
    }

    state.useHistory.splice(idx, 1);
    saveState();
    renderUseModeWorkspace();
    renderReceiveModeWorkspace();
    renderStatsModeWorkspace();
    renderFifoInventory();
  }

  async function executePrintLabelOnly(presetId) {
    const preset = state.presets.find((p) => p.id === presetId);
    if (!preset) return;

    if (!isPresetUnlockedInTrial(preset)) {
      openLicenseModal(
        `🔒 [${preset.title}] 품목은 30,000원 정식판 전용입니다. (무료 체험판은 기본 6종 품목만 출력 가능)`
      );
      return;
    }

    const now = new Date();
    const calc = calculateInclusiveExpiry(now, preset);

    const fbTitleEl = document.getElementById('simpleFeedbackTitle');
    const fbSubEl = document.getElementById('simpleFeedbackSub');
    if (fbTitleEl) fbTitleEl.textContent = `[${preset.title}] 라벨 출력 완료`;
    if (fbSubEl) fbSubEl.textContent = `만료기한: ${calc.expiresAtFormatted} 까지 (재고 차감 없음)`;

    await issueLabelFromPreset(preset, '라벨 단독 출력');
  }

  function executeSimpleQuickAddStock(presetId, addQty = 1) {
    const preset = state.presets.find((p) => p.id === presetId);
    if (!preset) return;

    const qtyToAdd = Math.max(1, Number(addQty) || 1);
    const prod = getOrEnsureProductForPreset(preset, true);
    const customExpEl = document.getElementById('receiveCustomExpiryDate');
    const customExpVal = customExpEl && customExpEl.value ? customExpEl.value : '';

    let targetExpDate = customExpVal;
    if (!targetExpDate) {
      const activeLots = prod.lots
        .filter((l) => l.qty > 0)
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
      if (activeLots.length > 0) {
        targetExpDate = activeLots[activeLots.length - 1].expiryDate;
      } else {
        targetExpDate = addDaysToDateStr(new Date(), Math.max(9, Number(preset.days) || 9));
      }
    }

    const existingLot = prod.lots.find((l) => l.expiryDate === targetExpDate);
    if (existingLot) {
      existingLot.qty += qtyToAdd;
    } else {
      prod.lots.push({
        id: `lot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        expiryDate: targetExpDate,
        qty: qtyToAdd
      });
    }

    const totalQty = prod.lots
      .filter((l) => l.qty > 0)
      .reduce((acc, l) => acc + l.qty, 0);

    const cleanName = preset.title.replace(/\s*\((개봉|소분|제조|해동|당일|세척 후|4H)\)\s*$/, '');
    if (!Array.isArray(state.receiveHistory)) state.receiveHistory = [];
    state.receiveHistory.unshift({
      id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      presetId: preset.id,
      productId: prod.id,
      itemName: cleanName,
      qty: qtyToAdd,
      unit: prod.unit,
      expiryDate: targetExpDate,
      timeStr: formatDateTime(new Date())
    });

    const rTitleEl = document.getElementById('receiveFeedbackTitle');
    const rSubEl = document.getElementById('receiveFeedbackSub');
    if (rTitleEl) {
      rTitleEl.textContent = `[${cleanName}] +${qtyToAdd}${prod.unit} 입고 완료! (현재 총 ${totalQty}${prod.unit})`;
    }
    if (rSubEl) {
      rSubEl.textContent = `입고 포장기한: ${targetExpDate} · 보관구역: ${prod.zone}`;
    }

    saveState();
    renderSimpleModeWorkspace();
    renderReceiveModeWorkspace();
    renderFifoInventory();
    showToast(`[${cleanName}] 재고 +${qtyToAdd}${prod.unit} 입고 완료 (총 ${totalQty}${prod.unit})`);
  }

  function undoReceiveHistory(historyId) {
    if (!Array.isArray(state.receiveHistory)) return;
    const idx = state.receiveHistory.findIndex((h) => h.id === historyId);
    if (idx === -1) return;

    const entry = state.receiveHistory[idx];
    const prod =
      state.unopenedProducts.find((p) => p.id === entry.productId) ||
      state.unopenedProducts.find((p) => p.linkedPresetId === entry.presetId);

    if (prod) {
      const lot = prod.lots.find((l) => l.expiryDate === entry.expiryDate);
      if (lot) {
        lot.qty = Math.max(0, lot.qty - entry.qty);
      }
    }

    state.receiveHistory.splice(idx, 1);
    saveState();
    renderSimpleModeWorkspace();
    renderReceiveModeWorkspace();
    renderFifoInventory();
    showToast(`[${entry.itemName}] +${entry.qty}${entry.unit} 입고 내역이 취소되었습니다.`);
  }

  async function issueLabelFromPreset(preset, sourceNote, explicitOriginalExpiryStr) {
    const now = new Date();
    const calc = calculateInclusiveExpiry(now, preset);
    const originalExpiryFormatted = getOriginalExpiryFormattedForPreset(preset, explicitOriginalExpiryStr);

    state.labelSequence += 1;
    const code = `#L-${state.labelSequence}`;

    const newLabel = {
      presetId: preset.id,
      code,
      actionType: preset.actionType || '소분/개봉',
      itemName: preset.fullName,
      originalExpiryFormatted,
      openedAtFormatted: calc.openedAtFormatted,
      expiresAtFormatted: calc.expiresAtFormatted,
      ruleDetailText: calc.ruleDetailText,
      manager: state.currentStaff,
      storageMethod: preset.storage
    };

    state.lastPrintedLabel = newLabel;

    const newTimer = {
      id: `timer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      presetId: preset.id,
      code,
      itemName: preset.fullName,
      originalExpiryFormatted,
      openedAtFormatted: calc.openedAtFormatted,
      expiresAtFormatted: calc.expiresAtFormatted,
      expiresDateStr: calc.expiresDateStr,
      manager: state.currentStaff,
      storageMethod: preset.storage,
      isClosingTarget: preset.days === 1 || Boolean(preset.hours)
    };

    state.activeTimers.unshift(newTimer);
    saveState();

    renderCurrentSticker();
    renderSimpleModeWorkspace();
    renderActiveTimersAndBottomBar();

    const printResult = await printer.printLabel(newLabel);
    const prefix = sourceNote ? `${sourceNote} → ` : '';
    showToast(`${prefix}[${preset.title}] 당일포함 라벨(${calc.expiresAtFormatted}까지) 출력 완료 (${printResult.deviceName})`);
  }

  async function executeOpenPack(productId, lotId) {
    const product = state.unopenedProducts.find((p) => p.id === productId);
    if (!product) return;
    const lot = product.lots.find((l) => l.id === lotId);
    if (!lot || lot.qty <= 0) return;

    const openedLotExpiry = lot.expiryDate;
    lot.qty -= 1;
    state.roiSavedKrw += 3500;

    const linkedPreset =
      state.presets.find((p) => p.id === product.linkedPresetId) || {
        id: 'preset-temp',
        actionType: '개봉',
        title: `${product.name}`,
        fullName: `${product.name} (개봉)`,
        days: 5,
        storage: '냉장 (0~10℃)'
      };

    saveState();
    renderFifoInventory();

    await issueLabelFromPreset(
      linkedPreset,
      `${product.name} (-1${product.unit} 개봉 완료)`,
      openedLotExpiry
    );

    if (window.innerWidth <= 1260) {
      setMobileTab('label');
    }
  }

  function addStockItemToInventory({ name, zone, linkedPresetId, expiryDate, qty, photoUrl }) {
    let existingProd = state.unopenedProducts.find(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );

    if (!existingProd) {
      existingProd = {
        id: `prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        unit: '개',
        zone: zone || '우유·유제품 냉장',
        linkedPresetId: linkedPresetId || state.presets[0]?.id || 'preset-milk',
        photoUrl:
          photoUrl ||
          generateProductPhotoDataUrl(name, zone || '매장 입고 품목', '#059669', expiryDate),
        lots: []
      };
      state.unopenedProducts.unshift(existingProd);
    } else if (photoUrl) {
      existingProd.photoUrl = photoUrl;
    }

    const existingLot = existingProd.lots.find((l) => l.expiryDate === expiryDate);
    if (existingLot) {
      existingLot.qty += qty;
    } else {
      existingProd.lots.push({
        id: `lot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        expiryDate,
        qty
      });
    }
  }

  // ==========================================================================
  // Event Listeners
  // ==========================================================================

  function attachEvents() {
    const appShell = document.querySelector('.app-shell');
    if (appShell) {
      appShell.setAttribute('data-app-mode', state.appMode || 'SIMPLE');
      appShell.setAttribute('data-active-mobile-tab', (state.appMode || 'SIMPLE') === 'SIMPLE' ? 'simple' : 'stock');
    }

    // Top Header App Mode Switcher (라벨 출력 vs 사용 차감 vs 원터치 입고 vs 사용량 통계 vs 상세 관리)
    const btnModeSimple = document.getElementById('btnModeSimple');
    const btnModeUse = document.getElementById('btnModeUse');
    const btnModeReceive = document.getElementById('btnModeReceive');
    const btnModeStats = document.getElementById('btnModeStats');
    const btnModePro = document.getElementById('btnModePro');
    const btnGoToUseScreen = document.getElementById('btnGoToUseScreen');
    const btnGoToReceiveScreen = document.getElementById('btnGoToReceiveScreen');
    const btnBackToSimpleScreen = document.getElementById('btnBackToSimpleScreen');
    const btnBackToLabelFromUse = document.getElementById('btnBackToLabelFromUse');
    const btnGoToReceiveFromUse = document.getElementById('btnGoToReceiveFromUse');

    if (btnModeSimple) {
      btnModeSimple.addEventListener('click', () => {
        setAppMode('SIMPLE');
        if (window.innerWidth <= 1260) {
          setMobileTab('simple');
        }
      });
    }
    if (btnModeUse) {
      btnModeUse.addEventListener('click', () => {
        setAppMode('USE');
        if (window.innerWidth <= 1260) {
          setMobileTab('use');
        }
      });
    }
    if (btnModeReceive) {
      btnModeReceive.addEventListener('click', () => {
        setAppMode('RECEIVE');
        if (window.innerWidth <= 1260) {
          setMobileTab('receive');
        }
      });
    }
    if (btnModeStats) {
      btnModeStats.addEventListener('click', () => {
        setAppMode('STATS');
        if (window.innerWidth <= 1260) {
          setMobileTab('stats');
        }
      });
    }
    if (btnModePro) {
      btnModePro.addEventListener('click', () => {
        setAppMode('PRO');
        if (window.innerWidth <= 1260) {
          setMobileTab('stock');
        }
      });
    }

    // Statistics Dashboard Controls (일별 / 주별 / 월별 & 품목별 필터)
    document.querySelectorAll('.stats-period-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.statsPeriod = btn.getAttribute('data-stats-period') || 'DAILY';
        saveState(true);
        renderStatsModeWorkspace();
      });
    });

    const statsCategorySelect = document.getElementById('statsCategorySelect');
    if (statsCategorySelect) {
      statsCategorySelect.addEventListener('change', (e) => {
        state.statsCategory = e.target.value || 'ALL';
        state.statsItemId = 'ALL';
        saveState(true);
        renderStatsModeWorkspace();
      });
    }

    const statsItemSelect = document.getElementById('statsItemSelect');
    if (statsItemSelect) {
      statsItemSelect.addEventListener('change', (e) => {
        state.statsItemId = e.target.value || 'ALL';
        saveState(true);
        renderStatsModeWorkspace();
      });
    }

    const chkStatsSampleData = document.getElementById('chkStatsSampleData');
    if (chkStatsSampleData) {
      chkStatsSampleData.addEventListener('change', (e) => {
        state.statsIncludeSample = Boolean(e.target.checked);
        saveState(true);
        renderStatsModeWorkspace();
      });
    }

    const btnStatsResetItemFilter = document.getElementById('btnStatsResetItemFilter');
    if (btnStatsResetItemFilter) {
      btnStatsResetItemFilter.addEventListener('click', () => {
        state.statsItemId = 'ALL';
        saveState(true);
        renderStatsModeWorkspace();
      });
    }

    const statsRankingList = document.getElementById('statsRankingList');
    if (statsRankingList) {
      statsRankingList.addEventListener('click', (e) => {
        const row = e.target.closest('[data-action="select-stats-item"]');
        if (!row) return;
        const pid = row.getAttribute('data-preset-id');
        state.statsItemId = state.statsItemId === pid ? 'ALL' : pid;
        saveState(true);
        renderStatsModeWorkspace();
      });
    }
    if (btnGoToUseScreen) {
      btnGoToUseScreen.addEventListener('click', () => {
        setAppMode('USE');
      });
    }
    if (btnGoToReceiveScreen) {
      btnGoToReceiveScreen.addEventListener('click', () => {
        setAppMode('RECEIVE');
      });
    }
    if (btnBackToSimpleScreen) {
      btnBackToSimpleScreen.addEventListener('click', () => {
        setAppMode('SIMPLE');
      });
    }
    if (btnBackToLabelFromUse) {
      btnBackToLabelFromUse.addEventListener('click', () => {
        setAppMode('SIMPLE');
      });
    }
    if (btnGoToReceiveFromUse) {
      btnGoToReceiveFromUse.addEventListener('click', () => {
        setAppMode('RECEIVE');
      });
    }

    // Use Mode (사용 차감) Category Dropdown, Search Input, Kiosk Grid & History
    const useCatSelect = document.getElementById('useCategorySelect');
    if (useCatSelect) {
      useCatSelect.addEventListener('change', (e) => {
        state.useCategory = e.target.value || 'ALL';
        state.useBigFavOnly = false;
        saveState();
        renderUseModeWorkspace();
      });
    }

    const useSearchInput = document.getElementById('useSearchInput');
    if (useSearchInput) {
      useSearchInput.addEventListener('input', (e) => {
        state.useSearchQuery = e.target.value || '';
        renderUseModeWorkspace();
      });
    }

    function handleUseKioskOrFavClick(e) {
      const starBtn = e.target.closest('[data-action="toggle-fav-item"]');
      if (starBtn) {
        e.stopPropagation();
        const presetId = starBtn.getAttribute('data-preset-id');
        const preset = state.presets.find((p) => p.id === presetId);
        if (preset) {
          preset.isFav = !preset.isFav;
          state.favInitialized = true;
          saveState();
          renderSimpleModeWorkspace();
          renderUseModeWorkspace();
        }
        return;
      }

      const useBtn = e.target.closest('[data-action="use-one-touch"]');
      if (useBtn) {
        e.stopPropagation();
        const presetId = useBtn.getAttribute('data-preset-id');
        const qty = parseInt(useBtn.getAttribute('data-qty'), 10) || 1;
        executeQuickUseStock(presetId, qty);
      }
    }

    const useFavGiantGrid = document.getElementById('useFavGiantGrid');
    if (useFavGiantGrid) {
      useFavGiantGrid.addEventListener('click', handleUseKioskOrFavClick);
    }

    const useKioskGrid = document.getElementById('useKioskGrid');
    if (useKioskGrid) {
      useKioskGrid.addEventListener('click', handleUseKioskOrFavClick);
    }

    const btnToggleUseBigFavMode = document.getElementById('btnToggleUseBigFavMode');
    if (btnToggleUseBigFavMode) {
      btnToggleUseBigFavMode.addEventListener('click', () => {
        state.useBigFavOnly = !state.useBigFavOnly;
        saveState();
        renderUseModeWorkspace();
      });
    }

    const btnCloseUseBigFavMode = document.getElementById('btnCloseUseBigFavMode');
    if (btnCloseUseBigFavMode) {
      btnCloseUseBigFavMode.addEventListener('click', () => {
        state.useBigFavOnly = false;
        saveState();
        renderUseModeWorkspace();
      });
    }

    document.querySelectorAll('.use-fav-col-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cols = parseInt(btn.getAttribute('data-fav-cols'), 10) || 3;
        state.favCols = cols;
        saveState();
        renderSimpleModeWorkspace();
        renderUseModeWorkspace();
      });
    });

    const useHistoryList = document.getElementById('useHistoryList');
    if (useHistoryList) {
      useHistoryList.addEventListener('click', (e) => {
        const undoBtn = e.target.closest('[data-action="undo-use"]');
        if (!undoBtn) return;
        const historyId = undoBtn.getAttribute('data-history-id');
        undoUseHistory(historyId);
      });
    }

    // Receive Mode Category Dropdown & Search Input & Kiosk Grid
    const receiveCatSelect = document.getElementById('receiveCategorySelect');
    if (receiveCatSelect) {
      receiveCatSelect.addEventListener('change', (e) => {
        state.receiveCategory = e.target.value || 'ALL';
        saveState();
        renderReceiveModeWorkspace();
      });
    }

    const receiveSearchInput = document.getElementById('receiveSearchInput');
    if (receiveSearchInput) {
      receiveSearchInput.addEventListener('input', (e) => {
        state.receiveSearchQuery = e.target.value || '';
        renderReceiveModeWorkspace();
      });
    }

    const receiveKioskGrid = document.getElementById('receiveKioskGrid');
    if (receiveKioskGrid) {
      receiveKioskGrid.addEventListener('click', (e) => {
        const recBtn = e.target.closest('[data-action="receive-one-touch"]');
        if (!recBtn) return;
        const presetId = recBtn.getAttribute('data-preset-id');
        const qty = parseInt(recBtn.getAttribute('data-qty'), 10) || 1;
        executeSimpleQuickAddStock(presetId, qty);
      });
    }

    const receiveHistoryList = document.getElementById('receiveHistoryList');
    if (receiveHistoryList) {
      receiveHistoryList.addEventListener('click', (e) => {
        const undoBtn = e.target.closest('[data-action="undo-receive"]');
        if (!undoBtn) return;
        const historyId = undoBtn.getAttribute('data-history-id');
        undoReceiveHistory(historyId);
      });
    }

    // Simple Mode Category Dropdown & Search Input & Quick Receive & Kiosk Card Clicks
    const simpleCatSelect = document.getElementById('simpleCategorySelect');
    if (simpleCatSelect) {
      simpleCatSelect.addEventListener('change', (e) => {
        state.simpleCategory = e.target.value || 'ALL';
        state.bigFavOnly = false;
        saveState();
        renderSimpleModeWorkspace();
      });
    }

    const simpleSearchInput = document.getElementById('simpleSearchInput');
    if (simpleSearchInput) {
      simpleSearchInput.addEventListener('input', (e) => {
        state.simpleSearchQuery = e.target.value || '';
        renderSimpleModeWorkspace();
      });
    }

    const sampleScans = [
      { name: '우유 1L (매일우유)', zone: '우유·유제품 냉장', preset: 'preset-milk', daysOut: 9, qty: 10, color: '#0284C7' },
      { name: '블루베리베이스 1.2kg', zone: '시럽·소스·베이스 냉장', preset: 'preset-blueberry-sub', daysOut: 14, qty: 6, color: '#4F46E5' },
      { name: '파인애플과육 베이스', zone: '시럽·소스·베이스 냉장', preset: 'preset-pineapple-sub', daysOut: 12, qty: 4, color: '#D97706' },
      { name: '나타드코코', zone: '커피바·파우더·실온', preset: 'preset-natadecoco', daysOut: 30, qty: 8, color: '#0D9488' },
      { name: '휘핑크림·생크림 500ml', zone: '우유·유제품 냉장', preset: 'preset-whip-cream', daysOut: 10, qty: 6, color: '#059669' }
    ];
    let scanIndex = 0;

    function executeAutoScanAndSaveStock(customPhotoDataUrl) {
      const sample = sampleScans[scanIndex % sampleScans.length];
      scanIndex += 1;
      const expStr = addDaysToDateStr(new Date(), sample.daysOut);

      const nameInput = document.getElementById('receiveProductName');
      const zoneInput = document.getElementById('receiveZone');
      const presetInput = document.getElementById('receiveLinkedPreset');
      const expInput = document.getElementById('receiveExpiryDate');
      const qtyInput = document.getElementById('receiveQty');

      const finalName = (nameInput && nameInput.value.trim()) || sample.name;
      const finalZone = (zoneInput && zoneInput.value) || sample.zone;
      const finalPreset = (presetInput && presetInput.value) || sample.preset;
      const finalExp = expStr;
      const finalQty = (qtyInput && parseInt(qtyInput.value, 10)) || sample.qty;

      if (nameInput) nameInput.value = finalName;
      if (zoneInput) zoneInput.value = finalZone;
      if (presetInput) presetInput.value = finalPreset;
      if (expInput) expInput.value = finalExp;
      if (qtyInput) qtyInput.value = finalQty;

      const photoToSave =
        customPhotoDataUrl ||
        generateProductPhotoDataUrl(
          finalName,
          `${finalZone} · 스캔 수량 ${finalQty}개`,
          sample.color,
          finalExp
        );

      addStockItemToInventory({
        name: finalName,
        zone: finalZone,
        linkedPresetId: finalPreset,
        expiryDate: finalExp,
        qty: finalQty,
        photoUrl: photoToSave
      });

      if (!Array.isArray(state.receiveHistory)) state.receiveHistory = [];
      state.receiveHistory.unshift({
        id: `rec-scan-${Date.now()}`,
        presetId: finalPreset,
        productId: null,
        itemName: finalName,
        qty: finalQty,
        unit: '개',
        expiryDate: finalExp,
        timeStr: formatDateTime(new Date())
      });

      saveState();
      renderSimpleModeWorkspace();
      renderReceiveModeWorkspace();
      renderFifoInventory();
      printer.playPrintSound();

      const fbTitleEl = document.getElementById('simpleFeedbackTitle');
      const fbSubEl = document.getElementById('simpleFeedbackSub');
      if (fbTitleEl) {
        fbTitleEl.textContent = `[${finalName}] 유통기한(${finalExp}) 스캔 & 재고 자동 저장 완료!`;
      }
      if (fbSubEl) {
        fbSubEl.textContent = `자동 인식된 포장 소비기한: ${finalExp} · 입고 수량: +${finalQty}개 자동 반영됨`;
      }

      const rTitleEl = document.getElementById('receiveFeedbackTitle');
      const rSubEl = document.getElementById('receiveFeedbackSub');
      if (rTitleEl) {
        rTitleEl.textContent = `[${finalName}] 유통기한(${finalExp}) 스캔 & +${finalQty}개 자동 입고 완료!`;
      }
      if (rSubEl) {
        rSubEl.textContent = `자동 인식된 포장 소비기한: ${finalExp} · 입고 내역에 즉시 반영됨`;
      }

      showToast(`[유통기한 자동저장] ${finalName} (소비기한 ${finalExp}, +${finalQty}개) 즉시 저장 완료!`);
      return { photoToSave, finalName, finalExp, finalQty };
    }

    const btnSimpleScanAutoSave = document.getElementById('btnSimpleScanAutoSave');
    if (btnSimpleScanAutoSave) {
      btnSimpleScanAutoSave.addEventListener('click', () => {
        const rInput = document.getElementById('receiveProductName');
        if (rInput) rInput.value = '';
        executeAutoScanAndSaveStock(null);
      });
    }

    const btnReceiveScanAutoSave = document.getElementById('btnReceiveScanAutoSave');
    if (btnReceiveScanAutoSave) {
      btnReceiveScanAutoSave.addEventListener('click', () => {
        const rInput = document.getElementById('receiveProductName');
        if (rInput) rInput.value = '';
        executeAutoScanAndSaveStock(null);
      });
    }

    const btnReceiveDockScan = document.getElementById('btnReceiveDockScan');
    if (btnReceiveDockScan) {
      btnReceiveDockScan.addEventListener('click', () => {
        const rInput = document.getElementById('receiveProductName');
        if (rInput) rInput.value = '';
        executeAutoScanAndSaveStock(null);
      });
    }

    const btnReceiveDockManualModal = document.getElementById('btnReceiveDockManualModal');
    if (btnReceiveDockManualModal) {
      btnReceiveDockManualModal.addEventListener('click', () => {
        const openRecBtn = document.getElementById('btnOpenReceiveModal');
        if (openRecBtn) openRecBtn.click();
      });
    }

    const btnReceiveDockSlipModal = document.getElementById('btnReceiveDockSlipModal');
    if (btnReceiveDockSlipModal) {
      btnReceiveDockSlipModal.addEventListener('click', () => {
        const openSlipBtn = document.getElementById('btnOpenSlipModal');
        if (openSlipBtn) openSlipBtn.click();
      });
    }

    function handleSimpleKioskCardOrFavClick(e) {
      const starBtn = e.target.closest('[data-action="toggle-fav-item"]');
      if (starBtn) {
        e.stopPropagation();
        const presetId = starBtn.getAttribute('data-preset-id');
        const preset = state.presets.find((p) => p.id === presetId);
        if (preset) {
          preset.isFav = !preset.isFav;
          state.favInitialized = true;
          saveState();
          renderSimpleModeWorkspace();
          renderUseModeWorkspace();
        }
        return;
      }

      const printBtn = e.target.closest('[data-action="print-label-only"]');
      if (printBtn) {
        e.stopPropagation();
        const presetId = printBtn.getAttribute('data-preset-id');
        executePrintLabelOnly(presetId);
      }
    }

    const favGiantGrid = document.getElementById('favGiantGrid');
    if (favGiantGrid) {
      favGiantGrid.addEventListener('click', handleSimpleKioskCardOrFavClick);
    }

    const simpleKioskGrid = document.getElementById('simpleKioskGrid');
    if (simpleKioskGrid) {
      simpleKioskGrid.addEventListener('click', handleSimpleKioskCardOrFavClick);
    }

    const btnToggleBigFavMode = document.getElementById('btnToggleBigFavMode');
    if (btnToggleBigFavMode) {
      btnToggleBigFavMode.addEventListener('click', () => {
        state.bigFavOnly = !state.bigFavOnly;
        saveState();
        renderSimpleModeWorkspace();
      });
    }

    const btnCloseBigFavMode = document.getElementById('btnCloseBigFavMode');
    if (btnCloseBigFavMode) {
      btnCloseBigFavMode.addEventListener('click', () => {
        state.bigFavOnly = false;
        saveState();
        renderSimpleModeWorkspace();
      });
    }

    document.querySelectorAll('.fav-col-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cols = parseInt(btn.getAttribute('data-fav-cols'), 10) || 3;
        state.favCols = cols;
        saveState();
        renderSimpleModeWorkspace();
        renderUseModeWorkspace();
      });
    });

    const favSelectDialog = document.getElementById('favSelectDialog');
    const btnOpenFavSelectModal = document.getElementById('btnOpenFavSelectModal');
    const btnOpenFavSelectFromUse = document.getElementById('btnOpenFavSelectFromUse');
    const btnCloseFavSelectModal = document.getElementById('btnCloseFavSelectModal');
    const btnDoneFavSelectModal = document.getElementById('btnDoneFavSelectModal');
    const favModalSearchInput = document.getElementById('favModalSearchInput');
    const btnFavResetRecommended = document.getElementById('btnFavResetRecommended');
    const btnFavClearAll = document.getElementById('btnFavClearAll');
    const favPickerModalGrid = document.getElementById('favPickerModalGrid');

    if (btnOpenFavSelectModal && favSelectDialog) {
      btnOpenFavSelectModal.addEventListener('click', () => {
        if (favModalSearchInput) favModalSearchInput.value = '';
        renderFavPickerModal();
        favSelectDialog.showModal();
      });
    }
    if (btnOpenFavSelectFromUse && favSelectDialog) {
      btnOpenFavSelectFromUse.addEventListener('click', () => {
        if (favModalSearchInput) favModalSearchInput.value = '';
        renderFavPickerModal();
        favSelectDialog.showModal();
      });
    }
    if (btnCloseFavSelectModal && favSelectDialog) {
      btnCloseFavSelectModal.addEventListener('click', () => favSelectDialog.close());
    }
    if (btnDoneFavSelectModal && favSelectDialog) {
      btnDoneFavSelectModal.addEventListener('click', () => favSelectDialog.close());
    }
    if (favModalSearchInput) {
      favModalSearchInput.addEventListener('input', () => renderFavPickerModal());
    }
    if (btnFavResetRecommended) {
      btnFavResetRecommended.addEventListener('click', () => {
        applyRecommendedFavs(state.presets);
        state.favInitialized = true;
        saveState();
        renderFavPickerModal();
        renderSimpleModeWorkspace();
        renderUseModeWorkspace();
      });
    }
    if (btnFavClearAll) {
      btnFavClearAll.addEventListener('click', () => {
        state.presets.forEach((p) => {
          p.isFav = false;
        });
        state.favInitialized = true;
        saveState();
        renderFavPickerModal();
        renderSimpleModeWorkspace();
        renderUseModeWorkspace();
      });
    }
    if (favPickerModalGrid) {
      favPickerModalGrid.addEventListener('click', (e) => {
        const item = e.target.closest('[data-action="modal-toggle-fav"]');
        if (!item) return;
        const presetId = item.getAttribute('data-preset-id');
        const preset = state.presets.find((p) => p.id === presetId);
        if (preset) {
          preset.isFav = !preset.isFav;
          state.favInitialized = true;
          saveState();
          renderFavPickerModal();
          renderSimpleModeWorkspace();
          renderUseModeWorkspace();
        }
      });
    }

    const btnSimpleReprint = document.getElementById('btnSimpleReprint');
    if (btnSimpleReprint) {
      btnSimpleReprint.addEventListener('click', async () => {
        if (!state.lastPrintedLabel) return;
        renderCurrentSticker();
        await printer.printLabel(state.lastPrintedLabel);
        showToast(`[${state.lastPrintedLabel.itemName}] 라벨을 한 장 더 출력했습니다.`);
      });
    }

    const btnSimpleSystemPrint = document.getElementById('btnSimpleSystemPrint');
    if (btnSimpleSystemPrint) {
      btnSimpleSystemPrint.addEventListener('click', () => {
        window.print();
      });
    }

    document.querySelectorAll('[data-mobile-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-mobile-tab');
        if (targetTab) setMobileTab(targetTab);
      });
    });

    // Staff Switcher
    document.querySelectorAll('.staff-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.currentStaff = btn.getAttribute('data-staff');
        saveState();
        renderStaffButtons();
        showToast(`근무 담당자가 [${state.currentStaff}](으)로 변경되었습니다.`);
      });
    });

    // Dropdown Filter Event Listeners (View Mode / Remaining Days / Zone)
    const viewModeSelect = document.getElementById('viewModeSelect');
    if (viewModeSelect) {
      viewModeSelect.addEventListener('change', (e) => {
        state.viewMode = e.target.value;
        saveState();
        renderFifoInventory();
      });
    }

    const ddayFilterSelect = document.getElementById('ddayFilterSelect');
    if (ddayFilterSelect) {
      ddayFilterSelect.addEventListener('change', (e) => {
        state.ddayFilter = e.target.value || 'ALL';
        saveState();
        renderFifoInventory();
      });
    }

    const zoneFilterSelect = document.getElementById('zoneFilterSelect');
    if (zoneFilterSelect) {
      zoneFilterSelect.addEventListener('change', (e) => {
        state.selectedZone = e.target.value || 'ALL';
        saveState();
        renderFifoInventory();
      });
    }

    // Preset Category Dropdown & Search Input
    const presetCatSelect = document.getElementById('presetCategorySelect');
    if (presetCatSelect) {
      presetCatSelect.addEventListener('change', (e) => {
        state.selectedPresetCategory = e.target.value || 'FAV';
        saveState();
        renderPresetGrid();
      });
    }

    const presetSearchInput = document.getElementById('presetSearchInput');
    if (presetSearchInput) {
      presetSearchInput.addEventListener('input', (e) => {
        state.presetSearchQuery = e.target.value || '';
        renderPresetGrid();
      });
    }

    // Safety Storage Manual Reference Table Modal & Multi-Brand / CSV Import-Export
    const manualDialog = document.getElementById('manualTableDialog');
    const btnOpenManual = document.getElementById('btnOpenManualModal');
    const btnCloseManual = document.getElementById('btnCloseManualModal');
    if (btnOpenManual && manualDialog) {
      btnOpenManual.addEventListener('click', () => {
        renderManualReferenceTable();
        manualDialog.showModal();
      });
    }
    if (btnCloseManual && manualDialog) {
      btnCloseManual.addEventListener('click', () => {
        manualDialog.close();
      });
    }

    const brandTemplateSelect = document.getElementById('brandTemplateSelect');
    if (brandTemplateSelect) {
      brandTemplateSelect.addEventListener('change', (e) => {
        const key = e.target.value;
        if (key === 'CUSTOM') {
          state.brandTemplate = 'CUSTOM';
          saveState();
          renderManualReferenceTable();
          return;
        }
        const tpl = getBrandTemplateData(key);
        state.brandTemplate = key;
        state.brandName = tpl.brandName;
        state.presets = tpl.presets.map((p) => ({ ...p }));
        state.unopenedProducts = rebuildProductsFromPresets(state.presets);
        state.simpleCategory = 'ALL';
        state.receiveCategory = 'ALL';
        state.selectedPresetCategory = 'ALL';
        saveState();
        renderAll();
        renderManualReferenceTable();
        updateCsvBannerMessage(
          `✓ <strong>[${tpl.brandName}]</strong> 기준표(${state.presets.length}종)가 적용되었습니다. 모든 소분·입고 버튼이 해당 브랜드 기준으로 전환되었습니다.`,
          true
        );
      });
    }

    const customBrandNameInput = document.getElementById('customBrandNameInput');
    if (customBrandNameInput) {
      customBrandNameInput.addEventListener('input', (e) => {
        state.brandName = e.target.value.trim() || '커스텀 매장';
        saveState();
        const badgeTextEl = document.getElementById('currentBrandBadgeText');
        if (badgeTextEl) {
          badgeTextEl.textContent = `${state.brandName} (${state.presets.length}종)`;
        }
      });
    }

    async function handleCsvFileImport(file, mode) {
      if (!file) return;
      try {
        const csvText = await readCsvFileAsText(file);
        const importedPresets = parseCsvTextToPresets(csvText);
        if (importedPresets.length === 0) {
          updateCsvBannerMessage(
            `⚠️ 선택한 파일에서 유효한 품목 행을 찾지 못했습니다. [샘플 CSV 양식]을 참고하여 자재명과 보관일수를 입력해 주세요.`,
            false
          );
          return;
        }

        const fileBrandName = file.name.replace(/\.(csv|txt)$/i, '').trim() || '사용자 CSV 브랜드';

        if (mode === 'REPLACE') {
          state.brandTemplate = 'CUSTOM';
          state.brandName = fileBrandName;
          state.presets = importedPresets;
          state.unopenedProducts = rebuildProductsFromPresets(importedPresets);
          state.simpleCategory = 'ALL';
          state.receiveCategory = 'ALL';
          state.selectedPresetCategory = 'ALL';
          updateCsvBannerMessage(
            `✓ <strong>[${file.name}]</strong>에서 총 <strong>${importedPresets.length}개 품목</strong>을 불러와 전체 교체했습니다! 소분·입고 화면에 즉시 반영되었습니다.`,
            true
          );
        } else {
          state.brandTemplate = 'CUSTOM';
          const newProds = rebuildProductsFromPresets(importedPresets);
          state.presets = [...importedPresets, ...state.presets];
          state.unopenedProducts = [...newProds, ...state.unopenedProducts];
          updateCsvBannerMessage(
            `✓ <strong>[${file.name}]</strong>에서 <strong>+${importedPresets.length}개 품목</strong>을 기존 목록에 추가했습니다! (현재 총 ${state.presets.length}종)`,
            true
          );
        }

        saveState();
        renderAll();
        renderManualReferenceTable();
      } catch (err) {
        updateCsvBannerMessage(`⚠️ CSV 파일 읽기 오류: ${err.message || '파일 형식을 확인해 주세요.'}`, false);
      }
    }

    const csvFileReplaceInput = document.getElementById('csvFileReplaceInput');
    if (csvFileReplaceInput) {
      csvFileReplaceInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        await handleCsvFileImport(file, 'REPLACE');
        e.target.value = '';
      });
    }

    const csvFileAppendInput = document.getElementById('csvFileAppendInput');
    if (csvFileAppendInput) {
      csvFileAppendInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        await handleCsvFileImport(file, 'APPEND');
        e.target.value = '';
      });
    }

    const btnExportCsv = document.getElementById('btnExportCsv');
    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', () => {
        exportCurrentPresetsToCsv();
      });
    }

    const btnDownloadSampleCsv = document.getElementById('btnDownloadSampleCsv');
    if (btnDownloadSampleCsv) {
      btnDownloadSampleCsv.addEventListener('click', () => {
        downloadSampleCsvTemplate();
      });
    }

    const manualTbody = document.getElementById('manualReferenceTableBody');
    if (manualTbody) {
      manualTbody.addEventListener('click', (e) => {
        const delBtn = e.target.closest('[data-action="delete-from-manual"]');
        if (delBtn) {
          const presetId = delBtn.getAttribute('data-preset-id');
          state.presets = state.presets.filter((p) => p.id !== presetId);
          state.unopenedProducts = state.unopenedProducts.filter((prod) => prod.linkedPresetId !== presetId);
          saveState();
          renderAll();
          renderManualReferenceTable();
          return;
        }

        const btn = e.target.closest('[data-action="print-from-manual"]');
        if (!btn) return;
        const presetId = btn.getAttribute('data-preset-id');
        const preset = state.presets.find((p) => p.id === presetId);
        if (preset) {
          manualDialog.close();
          issueLabelFromPreset(preset, '기준표 선택');
          if (window.innerWidth <= 1260) {
            setMobileTab('label');
          }
        }
      });
    }

    // Left Pane Interactions
    const fifoListEl = document.getElementById('fifoInventoryList');
    fifoListEl.addEventListener('click', (e) => {
      const zoomThumb = e.target.closest('[data-action="zoom-product-photo"]');
      if (zoomThumb) {
        const prodId = zoomThumb.getAttribute('data-product-id');
        const prod = state.unopenedProducts.find((p) => p.id === prodId);
        if (prod && prod.photoUrl) {
          openPhotoZoom(`${prod.name} — 입고 물건 촬영 사진`, prod.photoUrl, `보관구역: ${prod.zone}`);
        }
        return;
      }

      const btn = e.target.closest('[data-action="open-lot"]');
      if (!btn) return;

      const productId = btn.getAttribute('data-product-id');
      const lotId = btn.getAttribute('data-lot-id');
      const isFirst = btn.getAttribute('data-is-first') === 'true';

      if (!isFirst) {
        const product = state.unopenedProducts.find((p) => p.id === productId);
        const sortedLots = product.lots
          .filter((l) => l.qty > 0)
          .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
        const firstLot = sortedLots[0];

        pendingFifoOverride = { productId, lotId };
        const warnMsg = document.getElementById('fifoWarnMessage');
        warnMsg.textContent = `[${product.name}] 품목에 먼저 만료되는 선입선출 1순위 재고(${formatShortDate(
          firstLot.expiryDate
        )} 만료, ${firstLot.qty}${product.unit})가 아직 남아 있습니다!`;
        document.getElementById('fifoWarningDialog').showModal();
        return;
      }

      executeOpenPack(productId, lotId);
    });

    fifoListEl.addEventListener('change', async (e) => {
      const input = e.target.closest('[data-action="quick-upload-prod-photo"]');
      if (!input || !input.files || !input.files[0]) return;
      const prodId = input.getAttribute('data-product-id');
      const prod = state.unopenedProducts.find((p) => p.id === prodId);
      if (!prod) return;

      const dataUrl = await resizeImageFileToDataUrl(input.files[0], 640);
      prod.photoUrl = dataUrl;
      saveState();
      renderFifoInventory();
      showToast(`[${prod.name}] 물건 사진이 저장되었습니다.`);
    });

    // FIFO Warning Dialog buttons
    document.getElementById('btnCloseFifoWarn').addEventListener('click', () => {
      document.getElementById('fifoWarningDialog').close();
    });
    document.getElementById('btnCancelFifoOverride').addEventListener('click', () => {
      pendingFifoOverride = null;
      document.getElementById('fifoWarningDialog').close();
    });
    document.getElementById('btnConfirmFifoOverride').addEventListener('click', () => {
      document.getElementById('fifoWarningDialog').close();
      if (pendingFifoOverride) {
        executeOpenPack(pendingFifoOverride.productId, pendingFifoOverride.lotId);
        pendingFifoOverride = null;
      }
    });

    // Right Pane: One-Touch Preset Button Click
    document.getElementById('presetGrid').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="print-preset"]');
      if (!btn) return;
      const presetId = btn.getAttribute('data-preset-id');
      const preset = state.presets.find((p) => p.id === presetId);
      if (preset) {
        issueLabelFromPreset(preset, null);
      }
    });

    document.getElementById('btnReprintCurrent').addEventListener('click', async () => {
      if (!state.lastPrintedLabel) return;
      renderCurrentSticker();
      await printer.printLabel(state.lastPrintedLabel);
      showToast(`[${state.lastPrintedLabel.itemName}] 라벨을 재출력했습니다.`);
    });

    document.getElementById('btnSystemPrint').addEventListener('click', () => {
      window.print();
    });

    // Active Timers & Bottom Bar Disposal/Consume clicks
    function handleTimerAction(e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const timerId = btn.getAttribute('data-timer-id');
      if (action !== 'consume-timer' && action !== 'dispose-timer') return;

      const idx = state.activeTimers.findIndex((t) => t.id === timerId);
      if (idx === -1) return;
      const removed = state.activeTimers.splice(idx, 1)[0];

      if (action === 'dispose-timer') {
        state.roiSavedKrw += 15000;
        showToast(`[${removed.itemName}] 마감 폐기 완료 체크됨 (위생점검 리스크 방어)`);
      } else {
        showToast(`[${removed.itemName}] 기한 내 전량 소진 완료!`);
      }

      saveState();
      renderSimpleModeWorkspace();
      renderActiveTimersAndBottomBar();
    }

    document.getElementById('activeTimersList').addEventListener('click', handleTimerAction);
    document.getElementById('closingAlertChips').addEventListener('click', handleTimerAction);
    const simpleSavedListEl = document.getElementById('simpleSavedContainersList');
    if (simpleSavedListEl) {
      simpleSavedListEl.addEventListener('click', handleTimerAction);
    }

    document.getElementById('btnDisposeAllClosing').addEventListener('click', () => {
      const beforeCount = state.activeTimers.length;
      state.activeTimers = state.activeTimers.filter(
        (t) => !t.isClosingTarget && calcDDay(t.expiresDateStr) > 0
      );
      const removedCount = beforeCount - state.activeTimers.length;
      if (removedCount > 0) {
        state.roiSavedKrw += removedCount * 15000;
        saveState();
        renderActiveTimersAndBottomBar();
        showToast(`오늘 밤 마감 폐기 대상 ${removedCount}건을 일괄 폐기 완료 처리했습니다.`);
      }
    });

    function toggleAlertBarCollapsed() {
      state.alertBarCollapsed = !state.alertBarCollapsed;
      saveState();
      renderActiveTimersAndBottomBar();
    }

    const btnToggleAlertBar = document.getElementById('btnToggleAlertBar');
    if (btnToggleAlertBar) {
      btnToggleAlertBar.addEventListener('click', toggleAlertBarCollapsed);
    }

    const closingStatusBadge = document.getElementById('closingStatusBadge');
    if (closingStatusBadge) {
      closingStatusBadge.addEventListener('click', toggleAlertBarCollapsed);
    }

    // Multi-Mode Printer Setup Modal & Connection Controller
    const printerBtn = document.getElementById('btnConnectPrinter');
    const printerLabel = document.getElementById('printerStatusLabel');
    const printerSetupDialog = document.getElementById('printerSetupDialog');
    const printerModalStatusCard = document.getElementById('printerModalStatusCard');
    const printerModalStatusTitle = document.getElementById('printerModalStatusTitle');
    const printerModalStatusSub = document.getElementById('printerModalStatusSub');

    function updatePrinterModalUI(customSubMessage = '') {
      const connected = Boolean(printer.isConnected);
      if (printerBtn) {
        printerBtn.classList.toggle('printer-connected', connected);
      }
      if (printerLabel) {
        printerLabel.textContent = connected ? '● 프린터 연결됨' : '프린터';
      }
      if (printerModalStatusCard) {
        printerModalStatusCard.classList.toggle('connected', connected);
      }
      if (printerModalStatusTitle && printerModalStatusSub) {
        if (connected) {
          printerModalStatusTitle.textContent = `✓ 프린터 연결 완료: ${printer.connectedName || '라벨 프린터'}`;
          printerModalStatusSub.textContent =
            customSubMessage ||
            '이제 [라벨 출력] 화면에서 품목 카드를 누르면 연결된 프린터로 즉시 라벨이 인쇄됩니다!';
        } else {
          printerModalStatusTitle.textContent = '현재 상태: 화면 미리보기 모드 (실제 프린터 미연결)';
          printerModalStatusSub.textContent =
            customSubMessage ||
            '아래 [1. 기본 프린터로 연결하기] 또는 [블루투스/USB 연결]을 선택해 주세요.';
        }
      }
    }

    printer.onStatusChange = () => {
      updatePrinterModalUI();
    };

    if (state.printerAutoSystem) {
      printer.connectSystemPrinter('기본 라벨 프린터 (자동인쇄)');
    }

    if (printerBtn && printerSetupDialog) {
      printerBtn.addEventListener('click', () => {
        updatePrinterModalUI();
        printerSetupDialog.showModal();
      });
    }

    const btnClosePrinterModal = document.getElementById('btnClosePrinterModal');
    const btnDonePrinterModal = document.getElementById('btnDonePrinterModal');
    if (btnClosePrinterModal && printerSetupDialog) {
      btnClosePrinterModal.addEventListener('click', () => printerSetupDialog.close());
    }
    if (btnDonePrinterModal && printerSetupDialog) {
      btnDonePrinterModal.addEventListener('click', () => printerSetupDialog.close());
    }

    const btnConnectSystemPrinter = document.getElementById('btnConnectSystemPrinter');
    if (btnConnectSystemPrinter) {
      btnConnectSystemPrinter.addEventListener('click', () => {
        printer.connectSystemPrinter('기본 라벨 프린터 (USB·블루투스·Wi-Fi)');
        state.printerAutoSystem = true;
        saveState(true);
        updatePrinterModalUI(
          '✓ 기본 프린터 연결이 활성화되었습니다! 이제 품목을 누를 때마다 즉시 프린터 인쇄가 실행됩니다.'
        );
      });
    }

    const btnConnectBleModal = document.getElementById('btnConnectBleModal');
    if (btnConnectBleModal) {
      btnConnectBleModal.addEventListener('click', async () => {
        try {
          updatePrinterModalUI('📡 주변 블루투스(BLE) 라벨 프린터를 검색 중입니다...');
          const name = await printer.connectBluetooth();
          state.printerAutoSystem = false;
          saveState(true);
          updatePrinterModalUI(`✓ 블루투스 프린터 [${name}] 무선 페어링 완료!`);
        } catch (err) {
          updatePrinterModalUI(`⚠️ ${err.message || '블루투스 연결이 취소되었거나 지원되지 않습니다.'}`);
        }
      });
    }

    const btnConnectUsbModal = document.getElementById('btnConnectUsbModal');
    if (btnConnectUsbModal) {
      btnConnectUsbModal.addEventListener('click', async () => {
        try {
          updatePrinterModalUI('🔌 USB 시리얼 포트 프린터를 선택해 주세요...');
          const name = await printer.connectUsbSerial();
          state.printerAutoSystem = false;
          saveState(true);
          updatePrinterModalUI(`✓ [${name}] USB 포트 직접 연결 완료!`);
        } catch (err) {
          updatePrinterModalUI(`⚠️ ${err.message || 'USB 포트 선택이 취소되었습니다. [1. 기본 프린터로 연결하기]를 추천합니다.'}`);
        }
      });
    }

    const btnModalDisconnectPrinter = document.getElementById('btnModalDisconnectPrinter');
    if (btnModalDisconnectPrinter) {
      btnModalDisconnectPrinter.addEventListener('click', async () => {
        await printer.disconnectAll();
        state.printerAutoSystem = false;
        saveState(true);
        updatePrinterModalUI('프린터 연결이 해제되었습니다. (화면 미리보기 모드로 동작합니다)');
      });
    }

    const btnModalTestPrint = document.getElementById('btnModalTestPrint');
    if (btnModalTestPrint) {
      btnModalTestPrint.addEventListener('click', async () => {
        renderCurrentSticker();
        if (printer.isConnected && (printer.connectionType === 'BLE' || printer.connectionType === 'USB')) {
          await printer.printLabel(state.lastPrintedLabel);
          updatePrinterModalUI(`✓ [${printer.connectedName}]로 테스트 라벨 데이터를 전송했습니다!`);
        } else {
          if (printerSetupDialog && printerSetupDialog.open) {
            printerSetupDialog.close();
          }
          setTimeout(() => {
            window.print();
          }, 120);
        }
      });
    }

    const chkPrinterSound = document.getElementById('chkPrinterSound');
    if (chkPrinterSound) {
      chkPrinterSound.addEventListener('change', (e) => {
        printer.soundEnabled = Boolean(e.target.checked);
      });
    }

    // MODAL 1: Single Item Photo + Receive Dialog
    const receiveDialog = document.getElementById('stockReceiveDialog');
    const expiryInput = document.getElementById('receiveExpiryDate');
    const itemVideo = document.getElementById('itemCameraVideo');
    const itemPreviewImg = document.getElementById('itemPhotoPreviewImg');
    const itemPlaceholder = document.getElementById('itemPhotoPlaceholderText');
    const itemShutterBar = document.getElementById('itemCameraShutterBar');

    function setItemPreviewPhoto(dataUrl) {
      currentItemPhotoDataUrl = dataUrl;
      stopCameraStreams();
      if (dataUrl) {
        itemPreviewImg.src = dataUrl;
        itemPreviewImg.style.display = 'block';
        itemPlaceholder.style.display = 'none';
      } else {
        itemPreviewImg.style.display = 'none';
        itemPlaceholder.style.display = 'block';
      }
    }

    document.getElementById('btnOpenReceiveModal').addEventListener('click', () => {
      expiryInput.value = addDaysToDateStr(new Date(), 10);
      setItemPreviewPhoto(null);
      receiveDialog.showModal();
    });

    document.getElementById('btnCloseReceiveModal').addEventListener('click', () => {
      stopCameraStreams();
      receiveDialog.close();
    });

    document.getElementById('btnCancelReceiveModal').addEventListener('click', () => {
      stopCameraStreams();
      receiveDialog.close();
    });

    document.getElementById('btnStartItemCamera').addEventListener('click', async () => {
      stopCameraStreams();
      try {
        activeCameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false
        });
        itemVideo.srcObject = activeCameraStream;
        itemVideo.style.display = 'block';
        itemPreviewImg.style.display = 'none';
        itemPlaceholder.style.display = 'none';
        itemShutterBar.style.display = 'flex';
      } catch (_) {
        document.getElementById('itemPhotoFileInput').click();
      }
    });

    document.getElementById('btnCaptureItemFrame').addEventListener('click', () => {
      if (!itemVideo.videoWidth) return;
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = Math.round((itemVideo.videoHeight / itemVideo.videoWidth) * 640) || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(itemVideo, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      setItemPreviewPhoto(dataUrl);
      executeAutoScanAndSaveStock(dataUrl);
    });

    document.getElementById('itemPhotoFileInput').addEventListener('change', async (e) => {
      if (!e.target.files || !e.target.files[0]) return;
      const file = e.target.files[0];
      const dataUrl = await resizeImageFileToDataUrl(file, 640);
      setItemPreviewPhoto(dataUrl);
      executeAutoScanAndSaveStock(dataUrl);
    });

    document.getElementById('btnSimulateBarcodeScan').addEventListener('click', () => {
      document.getElementById('receiveProductName').value = '';
      const res = executeAutoScanAndSaveStock(null);
      setItemPreviewPhoto(res.photoToSave);
    });

    document.getElementById('stockReceiveForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('receiveProductName').value.trim();
      const zone = document.getElementById('receiveZone').value;
      const linkedPresetId = document.getElementById('receiveLinkedPreset').value;
      const expiryDate = document.getElementById('receiveExpiryDate').value;
      const qty = parseInt(document.getElementById('receiveQty').value, 10) || 1;

      if (!name || !expiryDate) return;

      addStockItemToInventory({
        name,
        zone,
        linkedPresetId,
        expiryDate,
        qty,
        photoUrl: currentItemPhotoDataUrl
      });

      saveState();
      renderSimpleModeWorkspace();
      renderFifoInventory();
      stopCameraStreams();
      receiveDialog.close();
      document.getElementById('receiveProductName').value = '';
      showToast(`[${name}] ${qty}개가 사진과 함께 입고 등록되었습니다!`);
    });

    // MODAL 4: Delivery Slip Photo Capture & Archive
    const slipDialog = document.getElementById('deliverySlipDialog');
    const slipVideo = document.getElementById('slipCameraVideo');
    const slipPreviewImg = document.getElementById('slipPhotoPreviewImg');
    const slipPlaceholder = document.getElementById('slipPhotoPlaceholderText');
    const slipShutterBar = document.getElementById('slipCameraShutterBar');

    function setSlipPreviewPhoto(dataUrl) {
      currentSlipPhotoDataUrl = dataUrl;
      stopCameraStreams();
      if (dataUrl) {
        slipPreviewImg.src = dataUrl;
        slipPreviewImg.style.display = 'block';
        slipPlaceholder.style.display = 'none';
      } else {
        slipPreviewImg.style.display = 'none';
        slipPlaceholder.style.display = 'block';
      }
    }

    function switchSlipTab(tabName) {
      const isCapture = tabName === 'capture';
      document.getElementById('tabBtnSlipCapture').classList.toggle('active', isCapture);
      document.getElementById('tabBtnSlipArchive').classList.toggle('active', !isCapture);
      document.getElementById('slipTabCapturePanel').style.display = isCapture ? 'flex' : 'none';
      document.getElementById('slipTabArchivePanel').style.display = isCapture ? 'none' : 'flex';
      if (!isCapture) {
        stopCameraStreams();
        renderSlipArchiveGrid();
      }
    }

    function resetSlipDraftRows() {
      const now = new Date();
      currentSlipDraftRows = [
        { name: '우유 1L (매일우유)', expiryDate: addDaysToDateStr(now, 7), qty: 12, zone: '우유·유제품 냉장' },
        { name: '블루베리베이스 1.2kg', expiryDate: addDaysToDateStr(now, 14), qty: 6, zone: '시럽·소스·베이스 냉장' },
        { name: '파인애플과육 베이스', expiryDate: addDaysToDateStr(now, 14), qty: 4, zone: '시럽·소스·베이스 냉장' }
      ];
      renderSlipDraftTable();
    }

    document.getElementById('btnOpenSlipModal').addEventListener('click', () => {
      resetSlipDraftRows();
      const nowStr = formatDateTime(new Date());
      const defaultSlipImg = generateDeliverySlipPhotoDataUrl(
        document.getElementById('slipSupplierInput').value || '메가MGC커피 물류 납품',
        currentSlipDraftRows,
        nowStr
      );
      setSlipPreviewPhoto(defaultSlipImg);
      switchSlipTab('capture');
      slipDialog.showModal();
    });

    document.getElementById('btnCloseSlipModal').addEventListener('click', () => {
      stopCameraStreams();
      slipDialog.close();
    });

    document.getElementById('tabBtnSlipCapture').addEventListener('click', () => switchSlipTab('capture'));
    document.getElementById('tabBtnSlipArchive').addEventListener('click', () => switchSlipTab('archive'));

    document.getElementById('btnStartSlipCamera').addEventListener('click', async () => {
      stopCameraStreams();
      try {
        activeCameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false
        });
        slipVideo.srcObject = activeCameraStream;
        slipVideo.style.display = 'block';
        slipPreviewImg.style.display = 'none';
        slipPlaceholder.style.display = 'none';
        slipShutterBar.style.display = 'flex';
      } catch (_) {
        document.getElementById('slipPhotoFileInput').click();
      }
    });

    document.getElementById('btnCaptureSlipFrame').addEventListener('click', () => {
      if (!slipVideo.videoWidth) return;
      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = Math.round((slipVideo.videoHeight / slipVideo.videoWidth) * 720) || 540;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(slipVideo, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      setSlipPreviewPhoto(dataUrl);
      printer.playPrintSound();
      showToast('거래명세서(입고리스트) 사진 촬영 완료!');
    });

    document.getElementById('slipPhotoFileInput').addEventListener('change', async (e) => {
      if (!e.target.files || !e.target.files[0]) return;
      const dataUrl = await resizeImageFileToDataUrl(e.target.files[0], 760);
      setSlipPreviewPhoto(dataUrl);
      printer.playPrintSound();
      showToast('입고리스트(거래명세서) 사진 파일이 불러와졌습니다.');
    });

    document.getElementById('btnSimulateSlipScan').addEventListener('click', () => {
      const now = new Date();
      const supplier = '메가MGC커피 본사물류 (오전 납품전표)';
      document.getElementById('slipSupplierInput').value = supplier;
      currentSlipDraftRows = [
        { name: '우유 1L (매일우유)', expiryDate: addDaysToDateStr(now, 6), qty: 15, zone: '우유·유제품 냉장' },
        { name: '블루베리베이스 1.2kg', expiryDate: addDaysToDateStr(now, 14), qty: 5, zone: '시럽·소스·베이스 냉장' },
        { name: '나타드코코', expiryDate: addDaysToDateStr(now, 30), qty: 4, zone: '커피바·파우더·실온' }
      ];
      renderSlipDraftTable();
      const slipPhoto = generateDeliverySlipPhotoDataUrl(
        supplier,
        currentSlipDraftRows,
        formatDateTime(now)
      );
      setSlipPreviewPhoto(slipPhoto);

      // Automatically save the scanned slip & all item expiry dates immediately
      state.deliverySlips.unshift({
        id: `slip-${Date.now()}`,
        supplier,
        capturedAt: formatDateTime(now),
        manager: '',
        photoUrl: slipPhoto,
        items: [...currentSlipDraftRows]
      });

      currentSlipDraftRows.forEach((item) => {
        addStockItemToInventory({
          name: item.name.trim(),
          zone: item.zone,
          linkedPresetId: null,
          expiryDate: item.expiryDate,
          qty: Number(item.qty) || 1,
          photoUrl: null
        });
      });

      saveState();
      renderAll();
      printer.playPrintSound();
      showToast('입고리스트 스캔 완료 → 3종 품목의 유통기한과 재고가 자동으로 즉시 저장되었습니다!');
    });

    document.getElementById('btnAddSlipRow').addEventListener('click', () => {
      currentSlipDraftRows.push({
        name: '',
        expiryDate: addDaysToDateStr(new Date(), 10),
        qty: 5,
        zone: '우유·유제품 냉장'
      });
      renderSlipDraftTable();
    });

    document.getElementById('slipItemsTableBody').addEventListener('input', (e) => {
      const el = e.target;
      const rowIdx = Number(el.getAttribute('data-slip-row'));
      const field = el.getAttribute('data-field');
      if (isNaN(rowIdx) || !field || !currentSlipDraftRows[rowIdx]) return;
      currentSlipDraftRows[rowIdx][field] =
        field === 'qty' ? parseInt(el.value, 10) || 1 : el.value;
    });

    document.getElementById('btnSaveSlipPhotoOnly').addEventListener('click', () => {
      const supplier = document.getElementById('slipSupplierInput').value.trim() || '입고 거래명세서';
      const nowStr = formatDateTime(new Date());
      const validItems = currentSlipDraftRows.filter((r) => r.name && r.name.trim());
      const photoUrl =
        currentSlipPhotoDataUrl ||
        generateDeliverySlipPhotoDataUrl(supplier, validItems, nowStr);

      state.deliverySlips.unshift({
        id: `slip-${Date.now()}`,
        supplier,
        capturedAt: nowStr,
        manager: state.currentStaff,
        photoUrl,
        items: validItems
      });

      saveState();
      renderSlipCountBadges();
      switchSlipTab('archive');
      showToast(`[${supplier}] 입고리스트 사진이 보관함에 저장되었습니다.`);
    });

    document.getElementById('btnSaveSlipAndBulkReceive').addEventListener('click', () => {
      const supplier = document.getElementById('slipSupplierInput').value.trim() || '입고 거래명세서';
      const nowStr = formatDateTime(new Date());
      const validItems = currentSlipDraftRows.filter((r) => r.name && r.name.trim());

      if (validItems.length === 0) {
        showToast('입고할 품목명을 1개 이상 입력해 주세요.');
        return;
      }

      const photoUrl =
        currentSlipPhotoDataUrl ||
        generateDeliverySlipPhotoDataUrl(supplier, validItems, nowStr);

      state.deliverySlips.unshift({
        id: `slip-${Date.now()}`,
        supplier,
        capturedAt: nowStr,
        manager: state.currentStaff,
        photoUrl,
        items: validItems
      });

      validItems.forEach((item) => {
        addStockItemToInventory({
          name: item.name.trim(),
          zone: item.zone,
          linkedPresetId: null,
          expiryDate: item.expiryDate,
          qty: Number(item.qty) || 1,
          photoUrl: null
        });
      });

      saveState();
      renderAll();
      switchSlipTab('archive');
      printer.playPrintSound();
      showToast(
        `명세서 사진 보관 완료 + 총 ${validItems.length}종 품목이 선입선출 재고로 일괄 입고되었습니다!`
      );
    });

    document.getElementById('slipArchiveGrid').addEventListener('click', (e) => {
      const zoomImg = e.target.closest('[data-action="zoom-slip-photo"]');
      if (zoomImg) {
        const slipId = zoomImg.getAttribute('data-slip-id');
        const slip = state.deliverySlips.find((s) => s.id === slipId);
        if (slip) {
          openPhotoZoom(
            `${slip.supplier} (${slip.capturedAt})`,
            slip.photoUrl,
            `검수 담당자: ${slip.manager} · 품목 ${slip.items.length}종`
          );
        }
        return;
      }

      const delBtn = e.target.closest('[data-action="delete-slip"]');
      if (delBtn) {
        const slipId = delBtn.getAttribute('data-slip-id');
        state.deliverySlips = state.deliverySlips.filter((s) => s.id !== slipId);
        saveState();
        renderSlipArchiveGrid();
        showToast('선택한 입고리스트 사진이 삭제되었습니다.');
      }
    });

    document.getElementById('btnClosePhotoZoom').addEventListener('click', () => {
      document.getElementById('photoZoomDialog').close();
    });

    // Modal 2: Owner Preset Configuration Dialog (당일포함 일수 등록)
    const presetDialog = document.getElementById('presetConfigDialog');
    document.getElementById('btnOpenPresetModal').addEventListener('click', () => {
      presetDialog.showModal();
    });
    document.getElementById('btnClosePresetModal').addEventListener('click', () => {
      presetDialog.close();
    });

    const btnOpenCsvFromPresetModal = document.getElementById('btnOpenCsvFromPresetModal');
    if (btnOpenCsvFromPresetModal) {
      btnOpenCsvFromPresetModal.addEventListener('click', () => {
        presetDialog.close();
        renderManualReferenceTable();
        if (manualDialog) manualDialog.showModal();
      });
    }

    document.getElementById('presetConfigForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const category = document.getElementById('presetCategoryInput').value.trim() || '기타 자재';
      const actionType = document.getElementById('presetTypeInput').value;
      const title = document.getElementById('presetTitleInput').value.trim();
      const fullName = document.getElementById('presetFullNameInput').value.trim();
      const days = Math.max(1, parseInt(document.getElementById('presetDaysInput').value, 10) || 1);
      const storage = document.getElementById('presetStorageInput').value;

      if (!title || !fullName) return;

      const newPreset = {
        id: `preset-${Date.now()}`,
        category,
        actionType,
        title,
        fullName,
        days,
        storage,
        note: `${actionType} 후 당일포함 ${days}일`,
        isFav: true
      };
      state.presets.unshift(newPreset);
      getOrEnsureProductForPreset(newPreset, true);

      saveState();
      renderAll();
      presetDialog.close();
      document.getElementById('presetTitleInput').value = '';
      document.getElementById('presetFullNameInput').value = '';
      showToast(`새 자재 [${title}] (당일포함 ${days}일) 프리셋이 추가되었습니다.`);
    });

    document.getElementById('btnResetDemoData').addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      state = createDefaultState();
      saveState();
      renderAll();
      renderCurrentSticker();
      presetDialog.close();
      showToast('기본 설정으로 초기화되었습니다. (재고·타이머 기록은 비어 있는 상태)');
    });

    // MODAL 8: Google Sheets Personal Cloud Sync Events
    const googleSyncDialog = document.getElementById('googleSyncDialog');
    const btnOpenGoogleSyncModal = document.getElementById('btnOpenGoogleSyncModal');
    const btnCloseGoogleSyncModal = document.getElementById('btnCloseGoogleSyncModal');
    const btnDoneGoogleSyncModal = document.getElementById('btnDoneGoogleSyncModal');

    if (btnOpenGoogleSyncModal && googleSyncDialog) {
      btnOpenGoogleSyncModal.addEventListener('click', () => {
        if (!isFullLicense()) {
          openLicenseModal('🔒 [내 구글 스프레드시트 실시간 연동 · 다른 핸드폰 확인]은 30,000원 정식판 전용 기능입니다.');
          return;
        }
        renderGoogleSyncStatus();
        googleSyncDialog.showModal();
      });
    }
    if (btnCloseGoogleSyncModal && googleSyncDialog) {
      btnCloseGoogleSyncModal.addEventListener('click', () => googleSyncDialog.close());
    }
    if (btnDoneGoogleSyncModal && googleSyncDialog) {
      btnDoneGoogleSyncModal.addEventListener('click', () => googleSyncDialog.close());
    }

    const btnSaveGoogleSyncUrl = document.getElementById('btnSaveGoogleSyncUrl');
    if (btnSaveGoogleSyncUrl) {
      btnSaveGoogleSyncUrl.addEventListener('click', async () => {
        const inputEl = document.getElementById('googleSheetWebAppUrlInput');
        const rawUrl = (inputEl && inputEl.value ? inputEl.value : '').trim();
        if (!rawUrl || !rawUrl.startsWith('http')) {
          renderGoogleSyncStatus('⚠️ 올바른 구글 Apps Script 웹 앱 주소(https://script.google.com/.../exec)를 입력해 주세요.');
          return;
        }
        state.googleSheetWebAppUrl = rawUrl;
        saveState(true);
        renderGoogleSyncStatus('✓ 구글 시트 연동 주소가 저장되었습니다. 데이터를 동기화합니다...');
        await pullStateFromGoogleSheet(false);
      });
    }

    const btnDisconnectGoogleSync = document.getElementById('btnDisconnectGoogleSync');
    if (btnDisconnectGoogleSync) {
      btnDisconnectGoogleSync.addEventListener('click', () => {
        state.googleSheetWebAppUrl = '';
        saveState(true);
        const inputEl = document.getElementById('googleSheetWebAppUrlInput');
        if (inputEl) inputEl.value = '';
        renderGoogleSyncStatus('연동이 해제되었습니다. 현재 기기 단독 저장 모드로 동작합니다.');
      });
    }

    const btnPushToGoogleSheet = document.getElementById('btnPushToGoogleSheet');
    if (btnPushToGoogleSheet) {
      btnPushToGoogleSheet.addEventListener('click', () => {
        if (!state.googleSheetWebAppUrl) {
          renderGoogleSyncStatus('⚠️ 먼저 아래 입력칸에 내 구글 시트 연동 주소를 붙여넣고 [연결 저장]을 눌러 주세요.');
          return;
        }
        pushStateToGoogleSheet(false);
      });
    }

    const btnPullFromGoogleSheet = document.getElementById('btnPullFromGoogleSheet');
    if (btnPullFromGoogleSheet) {
      btnPullFromGoogleSheet.addEventListener('click', () => {
        if (!state.googleSheetWebAppUrl) {
          renderGoogleSyncStatus('⚠️ 먼저 아래 입력칸에 내 구글 시트 연동 주소를 붙여넣고 [연결 저장]을 눌러 주세요.');
          return;
        }
        pullStateFromGoogleSheet(false);
      });
    }

    const chkGoogleAutoSync = document.getElementById('chkGoogleAutoSync');
    if (chkGoogleAutoSync) {
      chkGoogleAutoSync.addEventListener('change', (e) => {
        state.googleAutoSync = Boolean(e.target.checked);
        saveState(true);
        renderGoogleSyncStatus();
      });
    }

    const btnCopyAppsScriptCode = document.getElementById('btnCopyAppsScriptCode');
    if (btnCopyAppsScriptCode) {
      btnCopyAppsScriptCode.addEventListener('click', async () => {
        const scriptCode = getGoogleAppsScriptTemplateCode();
        try {
          await navigator.clipboard.writeText(scriptCode);
          btnCopyAppsScriptCode.textContent = '✓ 복사 완료! (Apps Script에 붙여넣으세요)';
          renderGoogleSyncStatus('✓ 자동 연동 코드가 복사되었습니다. 열린 구글 시트의 [확장 프로그램 > Apps Script]에 붙여넣으세요!');
          setTimeout(() => {
            btnCopyAppsScriptCode.textContent = '2. 자동 연동 코드 복사하기';
          }, 3500);
        } catch (_) {
          renderGoogleSyncStatus('⚠️ 클립보드 복사가 차단되었습니다.');
        }
      });
    }

    const btnCopyPhoneSyncLink = document.getElementById('btnCopyPhoneSyncLink');
    if (btnCopyPhoneSyncLink) {
      btnCopyPhoneSyncLink.addEventListener('click', async () => {
        const url = (state.googleSheetWebAppUrl || '').trim();
        if (!url) {
          renderGoogleSyncStatus('⚠️ 먼저 내 구글 시트 연동 주소를 저장한 뒤에 링크를 복사해 주세요.');
          return;
        }
        const baseHref = window.location.href.split('?')[0];
        const shareText = baseHref.startsWith('http')
          ? `${baseHref}?gsync=${encodeURIComponent(url)}`
          : url;
        try {
          await navigator.clipboard.writeText(shareText);
          btnCopyPhoneSyncLink.textContent = '✓ 복사 완료! 카톡으로 보내세요';
          renderGoogleSyncStatus('✓ 다른 핸드폰 연결용 주소가 복사되었습니다. 카카오톡으로 전송해 붙여넣으세요!');
          setTimeout(() => {
            btnCopyPhoneSyncLink.textContent = '📱 다른 핸드폰 자동연결 링크 복사';
          }, 3500);
        } catch (_) {}
      });
    }

    const btnExportFullBackupJson = document.getElementById('btnExportFullBackupJson');
    if (btnExportFullBackupJson) {
      btnExportFullBackupJson.addEventListener('click', () => {
        const backupObj = {
          exportedAt: formatDateTime(new Date()),
          payload: buildLightweightCloudPayload()
        };
        const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const dateTag = new Date().toISOString().slice(0, 10);
        a.download = `FreshLabel_백업_${state.brandName || '매장'}_${dateTag}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        renderGoogleSyncStatus('✓ 전체 데이터 백업 파일(.json)이 다운로드되었습니다.');
      });
    }

    const fullBackupJsonInput = document.getElementById('fullBackupJsonInput');
    if (fullBackupJsonInput) {
      fullBackupJsonInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const payload = parsed.payload || parsed;
          if (applyCloudPayloadToState(payload, Date.now())) {
            renderGoogleSyncStatus(`✓ [${file.name}] 백업 파일에서 전체 재고·품목 데이터를 복원했습니다!`);
          } else {
            renderGoogleSyncStatus('⚠️ 유효한 FreshLabel 백업 파일이 아닙니다.');
          }
        } catch (_) {
          renderGoogleSyncStatus('⚠️ 백업 파일 읽기 중 오류가 발생했습니다.');
        }
        e.target.value = '';
      });
    }

    // MODAL 9: Trial vs 30,000 KRW Lifetime Full Version Upgrade & Key Activation Events
    const licenseDialog = document.getElementById('licenseDialog');
    const btnOpenLicenseModal = document.getElementById('btnOpenLicenseModal');
    const btnCloseLicenseModal = document.getElementById('btnCloseLicenseModal');
    const btnDoneLicenseModal = document.getElementById('btnDoneLicenseModal');

    if (btnOpenLicenseModal) {
      btnOpenLicenseModal.addEventListener('click', () => {
        openLicenseModal('');
      });
    }
    if (btnCloseLicenseModal && licenseDialog) {
      btnCloseLicenseModal.addEventListener('click', () => licenseDialog.close());
    }
    if (btnDoneLicenseModal && licenseDialog) {
      btnDoneLicenseModal.addEventListener('click', () => licenseDialog.close());
    }

    const btnCopyPurchaseInquiry = document.getElementById('btnCopyPurchaseInquiry');
    if (btnCopyPurchaseInquiry) {
      btnCopyPurchaseInquiry.addEventListener('click', async () => {
        const msg = [
          '안녕하세요! 카페·베이커리 라벨출력 & 선입선출 재고관리 [FreshLabel 30,000원 정식판(평생 소장권)] 구매 및 인증코드 발급 문의드립니다.',
          '• 우리 매장명: ',
          '• 연락처: '
        ].join('\n');
        try {
          await navigator.clipboard.writeText(msg);
          btnCopyPurchaseInquiry.textContent = '✓ 구매 신청 문구 복사됨!';
          const fbEl = document.getElementById('licenseActivateFeedback');
          if (fbEl) {
            fbEl.style.color = '#059669';
            fbEl.textContent = '✓ 구매 신청 문구가 복사되었습니다! 우측 [카카오톡 구매·코드발급 문의] 버튼을 눌러 붙여넣어 보내주세요.';
          }
          setTimeout(() => {
            btnCopyPurchaseInquiry.textContent = '📋 구매 신청 카톡문구 복사';
          }, 3500);
        } catch (_) {}
      });
    }

    // Label Customizer Controls (담당자 · 라벨규격 · 큰글씨 · 유통기한/담당자 표시)
    const labelManagerNameInput = document.getElementById('labelManagerNameInput');
    if (labelManagerNameInput) {
      labelManagerNameInput.addEventListener('input', (e) => {
        state.currentStaff = e.target.value || '매장관리자';
        saveState();
        renderCurrentSticker();
      });
    }

    const quickPaperSizeSelect = document.getElementById('quickPaperSizeSelect');
    if (quickPaperSizeSelect) {
      quickPaperSizeSelect.addEventListener('change', (e) => {
        state.labelPaperSize = e.target.value || '58x40';
        printer.paperSize = state.labelPaperSize;
        saveState();
        renderCurrentSticker();
      });
    }

    const chkLargeLabelFont = document.getElementById('chkLargeLabelFont');
    if (chkLargeLabelFont) {
      chkLargeLabelFont.addEventListener('change', (e) => {
        state.labelLargeFont = Boolean(e.target.checked);
        saveState();
        renderCurrentSticker();
      });
    }

    const chkShowOrigExpiry = document.getElementById('chkShowOrigExpiry');
    if (chkShowOrigExpiry) {
      chkShowOrigExpiry.addEventListener('change', (e) => {
        state.labelShowOrigExpiry = Boolean(e.target.checked);
        saveState();
        renderCurrentSticker();
      });
    }

    const chkShowManager = document.getElementById('chkShowManager');
    if (chkShowManager) {
      chkShowManager.addEventListener('change', (e) => {
        state.labelShowManager = Boolean(e.target.checked);
        saveState();
        renderCurrentSticker();
      });
    }

    const btnActivateLicenseKey = document.getElementById('btnActivateLicenseKey');
    if (btnActivateLicenseKey) {
      btnActivateLicenseKey.addEventListener('click', async () => {
        const keyInput = document.getElementById('licenseKeyInput');
        const fbEl = document.getElementById('licenseActivateFeedback');
        const entered = (keyInput && keyInput.value ? keyInput.value : '').trim().toUpperCase();

        if (!entered) {
          if (fbEl) {
            fbEl.style.color = '#B91C1C';
            fbEl.textContent = '⚠️ 발급받은 정식판 인증코드를 입력해 주세요.';
          }
          return;
        }

        if (fbEl) {
          fbEl.style.color = '#2563EB';
          fbEl.textContent = '🔄 정품 라이선스 및 허용 기기 대수(최대 3대)를 확인 중입니다...';
        }
        btnActivateLicenseKey.disabled = true;
        clearLicenseKeyReleased();

        const result = await verifyLicenseWithCheckpointServer(entered, false);
        btnActivateLicenseKey.disabled = false;

        if (result.ok) {
          state.licenseTier = 'FULL';
          state.licenseKey = entered;
          saveState();
          renderAll();
          const alertBox = document.getElementById('licenseLockAlertBox');
          if (alertBox) alertBox.style.display = 'none';
          if (fbEl) {
            fbEl.style.color = '#059669';
            fbEl.textContent = result.message;
          }
          refreshCustomerDeviceManagerUI();
        } else {
          if (result.blockedOrExceeded) {
            state.licenseTier = 'TRIAL';
            saveState();
            renderAll();
          }
          if (fbEl) {
            fbEl.style.color = '#B91C1C';
            fbEl.textContent = result.message;
          }
          refreshCustomerDeviceManagerUI();
        }
      });
    }

    const btnRefreshCustomerDevices = document.getElementById('btnRefreshCustomerDevices');
    if (btnRefreshCustomerDevices) {
      btnRefreshCustomerDevices.addEventListener('click', () => {
        refreshCustomerDeviceManagerUI();
      });
    }

    const btnResetAllCustomerDevices = document.getElementById('btnResetAllCustomerDevices');
    if (btnResetAllCustomerDevices) {
      btnResetAllCustomerDevices.addEventListener('click', async () => {
        const keyInput = document.getElementById('licenseKeyInput');
        const targetKey = String((keyInput && keyInput.value) || state.licenseKey || '').trim().toUpperCase();
        const fbEl = document.getElementById('licenseActivateFeedback');
        if (!targetKey || !verifyLicenseKey(targetKey)) {
          if (fbEl) {
            fbEl.style.color = '#B91C1C';
            fbEl.textContent = '⚠️ 먼저 유효한 정식판 인증코드를 입력해 주세요.';
          }
          return;
        }
        btnResetAllCustomerDevices.disabled = true;
        const record = await fetchCheckpointRecordForKey(targetKey);
        if (record) {
          await saveCheckpointRecordState(targetKey, {
            ...record,
            devices: []
          });
        }
        btnResetAllCustomerDevices.disabled = false;
        markLicenseKeyReleased(targetKey);
        state.licenseTier = 'TRIAL';
        state.appMode = 'SIMPLE';
        saveState();
        renderAll();
        if (fbEl) {
          fbEl.style.color = '#059669';
          fbEl.textContent = `🔄 등록된 모든 기기가 0대로 초기화되었습니다! 다시 사용하시려면 [정식판 잠금 해제]를 눌러주세요.`;
        }
        await refreshCustomerDeviceManagerUI();
      });
    }

    const btnCustomerAddDevice = document.getElementById('btnCustomerAddDevice');
    if (btnCustomerAddDevice) {
      btnCustomerAddDevice.addEventListener('click', async () => {
        const keyInput = document.getElementById('licenseKeyInput');
        const nameInput = document.getElementById('customerNewDeviceNameInput');
        const fbEl = document.getElementById('licenseActivateFeedback');
        const targetKey = String((keyInput && keyInput.value) || state.licenseKey || '').trim().toUpperCase();
        if (!targetKey || !verifyLicenseKey(targetKey)) {
          if (fbEl) {
            fbEl.style.color = '#B91C1C';
            fbEl.textContent = '⚠️ 먼저 위에 유효한 정식판 인증코드를 입력해 주세요.';
          }
          return;
        }
        const customName = String((nameInput && nameInput.value) || '').trim() || '추가 매장기기';
        btnCustomerAddDevice.disabled = true;
        const record = await fetchCheckpointRecordForKey(targetKey);
        if (!record) {
          btnCustomerAddDevice.disabled = false;
          return;
        }
        if (record.status === 'BLOCKED') {
          btnCustomerAddDevice.disabled = false;
          if (fbEl) {
            fbEl.style.color = '#B91C1C';
            fbEl.textContent = '⛔ 사용 차단된 인증코드이므로 기기를 추가할 수 없습니다.';
          }
          return;
        }
        const maxDev = record.maxDevices || 3;
        const devs = Array.isArray(record.devices) ? [...record.devices] : [];
        if (devs.length >= maxDev) {
          btnCustomerAddDevice.disabled = false;
          if (fbEl) {
            fbEl.style.color = '#B91C1C';
            fbEl.textContent = `⛔ 허용된 최대 기기 대수(${maxDev}대)가 모두 찼습니다! 기존 기기를 [🗑️ 기기 삭제]하거나 판매자에게 기기 대수 추가를 요청해 주세요.`;
          }
          return;
        }
        const newId = `DEV-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        devs.push(`${newId} (${customName})`);
        await saveCheckpointRecordState(targetKey, {
          ...record,
          devices: devs
        });
        if (nameInput) nameInput.value = '';
        btnCustomerAddDevice.disabled = false;
        if (fbEl) {
          fbEl.style.color = '#059669';
          fbEl.textContent = `✅ [${customName}] 기기가 추가 등록되었습니다! (현재 ${devs.length}/${maxDev}대)`;
        }
        await refreshCustomerDeviceManagerUI();
      });
    }

    // ===== 다른 폰/태블릿 간편 연결 (QR · 링크 복사 · 공유) =====
    function buildDeviceConnectLink() {
      const keyInput = document.getElementById('licenseKeyInput');
      const targetKey = String((keyInput && keyInput.value) || state.licenseKey || '').trim().toUpperCase();
      if (!targetKey || !verifyLicenseKey(targetKey)) return '';
      const base = window.location.origin && window.location.origin !== 'null'
        ? `${window.location.origin}${window.location.pathname}`
        : 'https://dailyplantlabs.github.io/freshlabel1/';
      let link = `${base}?lkey=${encodeURIComponent(targetKey)}`;
      const chkInclude = document.getElementById('chkConnectIncludeSheet');
      if (state.googleSheetWebAppUrl && (!chkInclude || chkInclude.checked)) {
        link += `&gsync=${encodeURIComponent(state.googleSheetWebAppUrl)}`;
      }
      return link;
    }

    function refreshDeviceConnectBox() {
      const row = document.getElementById('deviceConnectSyncRow');
      if (row) row.style.display = state.googleSheetWebAppUrl ? 'flex' : 'none';
      const shareBtn = document.getElementById('btnShareDeviceLink');
      if (shareBtn) shareBtn.style.display = navigator.share ? 'inline-flex' : 'none';
      const panel = document.getElementById('connectQrPanel');
      if (panel && panel.style.display !== 'none') renderConnectQr();
    }

    function renderConnectQr() {
      const panel = document.getElementById('connectQrPanel');
      const img = document.getElementById('connectQrImg');
      const fbEl = document.getElementById('licenseActivateFeedback');
      const link = buildDeviceConnectLink();
      if (!link) {
        if (panel) panel.style.display = 'none';
        if (fbEl) {
          fbEl.style.color = '#B91C1C';
          fbEl.textContent = '⚠️ 먼저 유효한 정식판 인증코드를 입력해 주세요.';
        }
        return false;
      }
      if (typeof qrcode !== 'function') {
        if (fbEl) {
          fbEl.style.color = '#B91C1C';
          fbEl.textContent = '⚠️ QR 생성 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도하거나 [연결 링크 복사]를 사용해 주세요.';
        }
        return false;
      }
      const qr = qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      if (img) img.src = qr.createDataURL(6, 3);
      if (panel) panel.style.display = 'flex';
      return true;
    }

    const btnShowConnectQr = document.getElementById('btnShowConnectQr');
    if (btnShowConnectQr) {
      btnShowConnectQr.addEventListener('click', () => {
        const panel = document.getElementById('connectQrPanel');
        if (panel && panel.style.display === 'flex') {
          panel.style.display = 'none';
          btnShowConnectQr.textContent = '🔳 QR코드로 연결하기';
          return;
        }
        if (renderConnectQr()) btnShowConnectQr.textContent = '✕ QR코드 닫기';
      });
    }

    const chkConnectIncludeSheet = document.getElementById('chkConnectIncludeSheet');
    if (chkConnectIncludeSheet) {
      chkConnectIncludeSheet.addEventListener('change', () => {
        const panel = document.getElementById('connectQrPanel');
        if (panel && panel.style.display === 'flex') renderConnectQr();
      });
    }

    const licenseDialogForConnect = document.getElementById('licenseDialog');
    if (licenseDialogForConnect) {
      new MutationObserver(() => {
        if (licenseDialogForConnect.open) refreshDeviceConnectBox();
        else {
          const panel = document.getElementById('connectQrPanel');
          if (panel) panel.style.display = 'none';
          const btn = document.getElementById('btnShowConnectQr');
          if (btn) btn.textContent = '🔳 QR코드로 연결하기';
        }
      }).observe(licenseDialogForConnect, { attributes: true, attributeFilter: ['open'] });
    }

    const btnCopyDeviceAutoAuthLink = document.getElementById('btnCopyDeviceAutoAuthLink');
    if (btnCopyDeviceAutoAuthLink) {
      btnCopyDeviceAutoAuthLink.addEventListener('click', () => {
        const fbEl = document.getElementById('licenseActivateFeedback');
        const link = buildDeviceConnectLink();
        if (!link) {
          if (fbEl) {
            fbEl.style.color = '#B91C1C';
            fbEl.textContent = '⚠️ 먼저 유효한 정식판 인증코드를 입력해 주세요.';
          }
          return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link).catch(() => {});
        }
        if (fbEl) {
          fbEl.style.color = '#2563EB';
          fbEl.textContent = '🔗 연결 링크가 복사되었습니다! 새 폰에서 이 링크를 열면 바로 연결됩니다.';
        }
      });
    }

    const btnShareDeviceLink = document.getElementById('btnShareDeviceLink');
    if (btnShareDeviceLink) {
      btnShareDeviceLink.addEventListener('click', async () => {
        const fbEl = document.getElementById('licenseActivateFeedback');
        const link = buildDeviceConnectLink();
        if (!link) {
          if (fbEl) {
            fbEl.style.color = '#B91C1C';
            fbEl.textContent = '⚠️ 먼저 유효한 정식판 인증코드를 입력해 주세요.';
          }
          return;
        }
        try {
          await navigator.share({
            title: 'FreshLabel 기기 연결',
            text: '아래 링크를 열면 FreshLabel이 바로 연결됩니다.',
            url: link
          });
        } catch (_) {}
      });
    }  }

  // Auto-connect if opened with ?gsync=, ?lchk= (검문소 URL), or ?lkey= (자동 정품인증) parameters
  try {
    const params = new URLSearchParams(window.location.search);
    const gsyncParam = params.get('gsync');
    if (gsyncParam && gsyncParam.startsWith('http')) {
      state.googleSheetWebAppUrl = gsyncParam.trim();
      saveState(true);
    }
    const lchkParam = params.get('lchk');
    if (lchkParam) {
      const fullChkUrl = lchkParam.startsWith('http')
        ? lchkParam.trim()
        : `https://script.google.com/macros/s/${lchkParam.trim()}/exec`;
      localStorage.setItem(CHECKPOINT_URL_STORAGE_KEY, fullChkUrl);
    }
    const lkeyParam = params.get('lkey');
    // 새로고침할 때마다 다시 등록되지 않도록 주소창에서 인증 파라미터 제거
    if (lkeyParam || lchkParam || gsyncParam) {
      try {
        params.delete('lkey');
        params.delete('lchk');
        params.delete('gsync');
        const qs = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
      } catch (_) {}
    }
    if (lkeyParam && !isLicenseKeyReleased(lkeyParam)) {
      const cleanKey = lkeyParam.trim().toUpperCase();
      verifyLicenseWithCheckpointServer(cleanKey, false).then((res) => {
        if (res.ok) {
          state.licenseTier = 'FULL';
          state.licenseKey = cleanKey;
          saveState();
          renderAll();
        }
      });
    }
  } catch (_) {}

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // ==========================================================================
  // 편집 모드: 품목 버튼 순서 바꾸기 (◀ ▶ 버튼 / 드래그)
  // ==========================================================================
  let isEditOrderMode = false;
  const EDIT_ORDER_GRID_IDS = ['simpleKioskGrid', 'favGiantGrid', 'useKioskGrid', 'useFavGiantGrid', 'receiveKioskGrid'];
  const EDIT_ORDER_CARD_SELECTOR = '.simple-kiosk-card, .fav-giant-card, .use-kiosk-card, .receive-kiosk-card';

  function getEditGridCards(gridEl) {
    return Array.from(gridEl.children).filter((c) => c.dataset && c.dataset.presetId);
  }

  function movePresetOrder(presetId, targetId, position) {
    if (!presetId || !targetId || presetId === targetId) return false;
    const arr = state.presets;
    const from = arr.findIndex((p) => p.id === presetId);
    if (from < 0) return false;
    const [moved] = arr.splice(from, 1);
    const to = arr.findIndex((p) => p.id === targetId);
    if (to < 0) {
      arr.splice(from, 0, moved);
      return false;
    }
    arr.splice(position === 'after' ? to + 1 : to, 0, moved);
    return true;
  }

  function rerenderKeepingScroll() {
    const scrollers = Array.from(document.querySelectorAll('.simple-kiosk-scroll-body, .simple-kiosk-panel, .simple-kiosk-grid'));
    const saved = scrollers.map((el) => el.scrollTop);
    const winY = window.scrollY;
    renderAll();
    scrollers.forEach((el, i) => { el.scrollTop = saved[i]; });
    window.scrollTo(0, winY);
  }

  function applyEditOrderDecor() {
    document.body.classList.toggle('edit-order-mode', isEditOrderMode);
    document.querySelectorAll('.btn-edit-order-toggle').forEach((btn) => {
      btn.classList.toggle('active', isEditOrderMode);
      const lbl = btn.querySelector('.edit-order-label');
      if (lbl) lbl.textContent = isEditOrderMode ? '✓ 편집 완료' : '✏️ 편집';
    });

    let banner = document.getElementById('editOrderBanner');
    if (isEditOrderMode) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'editOrderBanner';
        banner.className = 'edit-order-banner';
        banner.innerHTML = '<span>✏️ 편집 중 · ◀ ▶ 버튼이나 드래그로 순서를 바꾸세요</span><button type="button" id="btnEditOrderDone">✓ 완료</button>';
        document.body.appendChild(banner);
        banner.querySelector('#btnEditOrderDone').addEventListener('click', () => setEditOrderMode(false));
      }
    } else if (banner) {
      banner.remove();
    }

    EDIT_ORDER_GRID_IDS.forEach((gridId) => {
      const gridEl = document.getElementById(gridId);
      if (!gridEl) return;
      const cards = getEditGridCards(gridEl);
      cards.forEach((card, idx) => {
        const old = card.querySelector(':scope > .edit-order-controls');
        if (old) old.remove();
        if (!isEditOrderMode) {
          card.removeAttribute('draggable');
          card.classList.remove('is-edit-card');
          return;
        }
        card.setAttribute('draggable', 'true');
        card.classList.add('is-edit-card');
        const ctl = document.createElement('div');
        ctl.className = 'edit-order-controls';
        ctl.innerHTML = `
          <button type="button" class="edit-order-btn" data-order-move="prev" aria-label="앞으로" ${idx === 0 ? 'disabled' : ''}>◀</button>
          <span class="edit-order-num tabular-nums">${idx + 1}</span>
          <button type="button" class="edit-order-btn" data-order-move="next" aria-label="뒤로" ${idx === cards.length - 1 ? 'disabled' : ''}>▶</button>
        `;
        card.appendChild(ctl);
      });
    });
  }

  function setEditOrderMode(on) {
    isEditOrderMode = Boolean(on);
    applyEditOrderDecor();
  }

  // Wrap workspace renderers so edit-mode controls are re-applied after every re-render
  (function wrapRenderersForEditMode() {
    const origSimple = renderSimpleModeWorkspace;
    renderSimpleModeWorkspace = function () { origSimple.apply(this, arguments); applyEditOrderDecor(); };
    const origUse = renderUseModeWorkspace;
    renderUseModeWorkspace = function () { origUse.apply(this, arguments); applyEditOrderDecor(); };
    const origReceive = renderReceiveModeWorkspace;
    renderReceiveModeWorkspace = function () { origReceive.apply(this, arguments); applyEditOrderDecor(); };
  })();

  document.querySelectorAll('.btn-edit-order-toggle').forEach((btn) => {
    btn.addEventListener('click', () => setEditOrderMode(!isEditOrderMode));
  });

  // Capture phase: in edit mode, card taps must not print / deduct / receive
  document.addEventListener('click', (e) => {
    if (!isEditOrderMode) return;
    const moveBtn = e.target.closest && e.target.closest('[data-order-move]');
    if (moveBtn) {
      e.stopPropagation();
      e.preventDefault();
      const card = moveBtn.closest('[data-preset-id]');
      const gridEl = card && card.parentElement;
      if (!gridEl) return;
      const cards = getEditGridCards(gridEl);
      const idx = cards.indexOf(card);
      const dir = moveBtn.getAttribute('data-order-move');
      const neighbor = dir === 'prev' ? cards[idx - 1] : cards[idx + 1];
      if (neighbor && movePresetOrder(card.dataset.presetId, neighbor.dataset.presetId, dir === 'prev' ? 'before' : 'after')) {
        saveState();
        rerenderKeepingScroll();
      }
      return;
    }
    const card = e.target.closest && e.target.closest(EDIT_ORDER_CARD_SELECTOR);
    if (card && card.parentElement && EDIT_ORDER_GRID_IDS.includes(card.parentElement.id)) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  let editDragPresetId = null;
  document.addEventListener('dragstart', (e) => {
    if (!isEditOrderMode) return;
    const card = e.target.closest && e.target.closest('.is-edit-card');
    if (!card) return;
    editDragPresetId = card.dataset.presetId;
    card.classList.add('is-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', editDragPresetId); } catch (_) {}
    }
  });
  document.addEventListener('dragover', (e) => {
    if (!isEditOrderMode || !editDragPresetId) return;
    const card = e.target.closest && e.target.closest('.is-edit-card');
    if (!card) return;
    e.preventDefault();
    document.querySelectorAll('.is-drag-over').forEach((el) => el.classList.remove('is-drag-over'));
    if (card.dataset.presetId !== editDragPresetId) card.classList.add('is-drag-over');
  });
  document.addEventListener('drop', (e) => {
    if (!isEditOrderMode || !editDragPresetId) return;
    const card = e.target.closest && e.target.closest('.is-edit-card');
    if (!card) return;
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    if (movePresetOrder(editDragPresetId, card.dataset.presetId, before ? 'before' : 'after')) {
      saveState();
      rerenderKeepingScroll();
    }
    editDragPresetId = null;
  });
  document.addEventListener('dragend', () => {
    editDragPresetId = null;
    document.querySelectorAll('.is-dragging, .is-drag-over').forEach((el) => el.classList.remove('is-dragging', 'is-drag-over'));
  });
  renderAll();
  renderCurrentSticker();
  attachEvents();
  if (state.googleSheetWebAppUrl) {
    pullStateFromGoogleSheet(true);
  }
  checkAndEnforceLicenseBlock();
  setInterval(renderClock, 1000);

  // Real-time (3-second) license / device sync + block enforcement
  function runRealtimeLicenseSync() {
    if (document.visibilityState === 'hidden') return;
    checkAndEnforceLicenseBlock();
    const dlg = document.getElementById('licenseDialog');
    if (dlg && dlg.open) {
      refreshCustomerDeviceManagerUI(true);
    }
  }

  setInterval(() => {
    runRealtimeLicenseSync();
  }, 3000);

  setInterval(() => {
    if (document.visibilityState !== 'hidden') {
      if (
        state.googleSheetWebAppUrl &&
        state.googleAutoSync &&
        !googlePushDebounceTimer
      ) {
        pullStateFromGoogleSheet(true);
      }
    }
  }, 5000);

  window.addEventListener('focus', () => {
    checkAndEnforceLicenseBlock();
    if (state.googleSheetWebAppUrl && state.googleAutoSync && !googlePushDebounceTimer) {
      pullStateFromGoogleSheet(true);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkAndEnforceLicenseBlock();
      if (state.googleSheetWebAppUrl && state.googleAutoSync && !googlePushDebounceTimer) {
        pullStateFromGoogleSheet(true);
      }
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      state = loadState();
      renderAll();
      renderCurrentSticker();
    } else if (e.key === 'freshlabel_seller_admin_ledger_v1') {
      checkAndEnforceLicenseBlock();
    }
  });
})();
