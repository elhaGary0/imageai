
import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Image as ImageIcon, AlertTriangle, CheckCircle, Loader2, RefreshCcw, Info, Camera, ChevronRight, ImagePlus, ScanSearch, Key, X, Settings2 } from 'lucide-react';

const internalApiKey = ""; // مفتاح المنصة الداخلي

export default function App() {
  const [imageSrc, setImageSrc] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null); 
  
  // إعدادات الـ API Key للمستخدم الخارجي
  const [customApiKey, setCustomApiKey] = useState('');
  const [apiProvider, setApiProvider] = useState('groq'); // الافتراضي أصبح groq لأنه الأسهل
  const [showSettings, setShowSettings] = useState(false);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // استرجاع الإعدادات المحفوظة عند التحميل
  useEffect(() => {
    try {
      const savedKey = localStorage.getItem('aiApiKey');
      const savedProvider = localStorage.getItem('aiProvider');
      if (savedKey) setCustomApiKey(savedKey);
      if (savedProvider) setApiProvider(savedProvider);
    } catch (e) {
      console.warn("localStorage غير متاح");
    }
  }, []);

  const handleSaveSettings = () => {
    const keyInput = document.getElementById('api-key-input').value.trim();
    const providerInput = document.getElementById('provider-select').value;
    
    setCustomApiKey(keyInput);
    setApiProvider(providerInput);
    
    try {
      localStorage.setItem('aiApiKey', keyInput);
      localStorage.setItem('aiProvider', providerInput);
    } catch (e) {}
    setShowSettings(false);
  };

  const handleClearApiKey = () => {
    setCustomApiKey('');
    try {
      localStorage.removeItem('aiApiKey');
    } catch (e) {}
    if (document.getElementById('api-key-input')) {
      document.getElementById('api-key-input').value = '';
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageSrc(reader.result);
        setResult(null);
        setError(null);
        setWarning(null);
      };
      reader.readAsDataURL(file);
    } else {
      setError("الرجاء اختيار ملف صورة صالح (JPEG, PNG).");
    }
  };

  const getMimeType = (dataUrl) => {
    return dataUrl.substring(dataUrl.indexOf(":") + 1, dataUrl.indexOf(";"));
  };

  // 1. الاتصال بـ Google Gemini
  const fetchGemini = async (model, key, prompt, mimeType, base64Data) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: mimeType, data: base64Data } }] }],
      generationConfig: { responseMimeType: "application/json" }
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
  };

  // 2. الاتصال بـ Groq - التحديث ليدعم أحدث النماذج المتاحة
  const fetchGroq = async (key, model, prompt, mimeType, base64Data) => {
    const url = "https://api.groq.com/openai/v1/chat/completions";
    const payload = {
      model: model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } }
          ]
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  };

  // الدالة الرئيسية للفحص
  const analyzeImage = async () => {
    if (!imageSrc) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setWarning(null);

    try {
      const base64Data = imageSrc.split(',')[1];
      const mimeType = getMimeType(imageSrc);

      const prompt = `
        أنت خبير في التصوير الجنائي الرقمي واكتشاف التزييف العميق والصور المولدة بالذكاء الاصطناعي.
        قم بتحليل هذه الصورة بدقة لمعرفة ما إذا كانت صورة حقيقية أم مولدة/معدلة بالذكاء الاصطناعي.
        أجب بصيغة JSON فقط متوافقة مع هذا الهيكل دون أي نصوص إضافية:
        {"status": "AI أو REAL", "confidence": رقم من 0 لـ 100 يعبر عن ثقتك, "analysis": "شرح مفصل باللغة العربية للأدلة والتشوهات التي وجدتها أو سبب اعتقادك أنها طبيعية"}
      `;

      let textResult = null;

      if (!customApiKey && !internalApiKey) {
         setError("للاستخدام الخارجي، الرجاء إدخال مفتاح API من الإعدادات بالأعلى.");
         setShowSettings(true);
         setLoading(false);
         return;
      }

      if (customApiKey) {
        if (apiProvider === 'groq') {
          // تحديث النماذج لأحدث إصدارات مدعومة من Groq (Llama 4 Scout و البدائل)
          const groqModels = [
            "meta-llama/llama-4-scout-17b-16e-instruct",
            "llama-4-scout-17b-16e-instruct",
            "llama-3.2-90b-vision-preview",
            "llama-3.2-11b-vision-preview"
          ];
          
          let lastErr = null;
          for (const model of groqModels) {
            try {
              textResult = await fetchGroq(customApiKey, model, prompt, mimeType, base64Data);
              if (textResult) break;
            } catch (err) {
              console.warn(`نموذج Groq (${model}) غير متاح أو به خطأ، جاري تجربة البديل...`, err.message);
              lastErr = err;
              
              // إذا كان الخطأ بسبب المفتاح غير الصحيح، لا داعي لتجربة باقي النماذج
              if (err.message.toLowerCase().includes('api key')) {
                  break;
              }
            }
          }

          if (!textResult) {
            throw new Error(`فشل الاتصال بـ Groq: تأكد من صحة المفتاح. التفاصيل: ${lastErr?.message}`);
          }

        } else if (apiProvider === 'gemini') {
          try {
            textResult = await fetchGemini("gemini-1.5-flash", customApiKey, prompt, mimeType, base64Data);
          } catch (err) {
            console.warn("فشل مفتاح Gemini الخاص بك، جاري التبديل للمنصة...", err.message);
            try {
               textResult = await fetchGemini("gemini-2.5-flash-preview-09-2025", internalApiKey, prompt, mimeType, base64Data);
               setWarning("تنبيه: مفتاح Gemini الخاص بك لم يعمل. تم استخدام خوادم المنصة بنجاح. يفضل استخدام Groq بدلاً منه.");
            } catch (fallbackErr) {
               throw new Error(`فشل الاتصال بـ Gemini: ${err.message}`);
            }
          }
        }
      } else {
        // الاعتماد على مفتاح المنصة الداخلي لو كنا داخل المنصة
        textResult = await fetchGemini("gemini-2.5-flash-preview-09-2025", internalApiKey, prompt, mimeType, base64Data);
      }

      if (!textResult) throw new Error("لم يتم استلام نتيجة.");

      // تنظيف JSON من أي شوائب
      const cleanJson = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
      setResult(JSON.parse(cleanJson));

    } catch (err) {
      console.error(err);
      setError(`خطأ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const resetAll = () => {
    setImageSrc(null);
    setImageFile(null);
    setResult(null);
    setError(null);
    setWarning(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-200/50 flex justify-center items-center font-sans" dir="rtl">
      <div className="w-full max-w-[400px] h-[100dvh] sm:h-[800px] bg-slate-50 sm:rounded-[2.5rem] sm:shadow-2xl relative flex flex-col overflow-hidden border-slate-300 sm:border-[8px]">
        
        <div className="h-6 w-full bg-slate-50 hidden sm:flex justify-center items-center pt-3 pb-2 z-20">
          <div className="w-24 h-5 bg-slate-200 rounded-full"></div>
        </div>

        <header className="bg-white/80 backdrop-blur-md px-5 py-4 flex items-center justify-between z-10 sticky top-0 border-b border-slate-100/50">
          <div className="flex items-center gap-3 w-full">
            {imageSrc && !loading && !result ? (
              <button onClick={() => setImageSrc(null)} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors">
                <ChevronRight className="w-5 h-5 text-slate-700" />
              </button>
            ) : (
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-md shrink-0">
                <ScanSearch className="w-5 h-5 text-white" />
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-lg font-bold text-slate-800 leading-tight">المحقق الذكي</h1>
              <p className="text-xs text-slate-500 font-medium">كاشف صور الذكاء الاصطناعي</p>
            </div>
            
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors relative"
            >
              <Settings2 className="w-5 h-5 text-slate-700" />
              {!customApiKey && !internalApiKey && (
                <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 border-2 border-white rounded-full"></span>
              )}
            </button>
          </div>
        </header>

        {showSettings && (
          <div className="absolute inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl p-6 w-full shadow-2xl animate-in zoom-in-95">
              <div className="flex justify-between items-center mb-5">
                <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-indigo-600" />
                  إعدادات محرك الذكاء الاصطناعي
                </h3>
                <button onClick={() => setShowSettings(false)} className="p-1.5 bg-slate-100 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-bold text-slate-700 mb-2">اختر المحرك (الشركة):</label>
                <select 
                  id="provider-select"
                  defaultValue={apiProvider}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  onChange={(e) => setApiProvider(e.target.value)}
                >
                  <option value="groq">Groq (Llama 4 Vision) - موصى به ومجاني</option>
                  <option value="gemini">Google Gemini - يتطلب فيزا بمصر</option>
                </select>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-bold text-slate-700 mb-2">مفتاح الربط (API Key):</label>
                <input 
                  type="text" 
                  placeholder={apiProvider === 'groq' ? "gsk_..." : "AIzaSy..."} 
                  defaultValue={customApiKey}
                  id="api-key-input"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-left font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  dir="ltr"
                />
                {apiProvider === 'groq' && (
                  <p className="text-xs text-slate-500 mt-2">
                    احصل على مفتاح مجاني وبدون فيزا من <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-indigo-600 font-bold underline">console.groq.com</a>
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={handleSaveSettings}
                  className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-colors"
                >
                  حفظ الإعدادات
                </button>
                {customApiKey && (
                  <button 
                    onClick={handleClearApiKey}
                    className="px-4 bg-red-100 text-red-600 font-bold py-3 rounded-xl hover:bg-red-200 transition-colors"
                    title="حذف المفتاح"
                  >
                    حذف
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto pb-28 relative scroll-smooth">
          {!imageSrc ? (
            <div className="p-6 flex flex-col h-full animate-in fade-in zoom-in-95 duration-500">
              <div className="flex-1 flex flex-col justify-center items-center text-center mt-[-10%]">
                <div className="w-24 h-24 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-6 shadow-inner relative">
                  <ImagePlus className="w-10 h-10 relative z-10" />
                  <div className="absolute inset-0 bg-indigo-400 rounded-full animate-ping opacity-20"></div>
                </div>
                <h2 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">فحص صورة جديدة</h2>
                <p className="text-slate-500 mb-8 px-2 text-sm leading-relaxed">
                  هل تشك في صورة ما؟ التقطها الآن أو اخترها من جهازك ليتم فحصها بالذكاء الاصطناعي.
                </p>
                
                <div className="grid grid-cols-2 gap-4 w-full mb-4">
                  <button 
                    onClick={() => cameraInputRef.current.click()}
                    className="flex flex-col items-center justify-center py-6 px-2 bg-indigo-600 text-white rounded-2xl shadow-[0_8px_20px_-8px_rgba(79,70,229,0.7)] active:scale-95 transition-all group"
                  >
                    <Camera className="w-8 h-8 mb-3 group-hover:scale-110 transition-transform" />
                    <span className="font-bold text-sm">فتح الكاميرا</span>
                  </button>
                  
                  <button 
                    onClick={() => fileInputRef.current.click()}
                    className="flex flex-col items-center justify-center py-6 px-2 bg-white text-slate-700 border-2 border-slate-200 rounded-2xl active:scale-95 hover:border-indigo-300 transition-all group shadow-sm"
                  >
                    <UploadCloud className="w-8 h-8 mb-3 text-indigo-500 group-hover:scale-110 transition-transform" />
                    <span className="font-bold text-sm">ملفات الجهاز</span>
                  </button>
                </div>

                <input type="file" ref={cameraInputRef} onChange={handleImageChange} accept="image/*" capture="environment" className="hidden" />
                <input type="file" ref={fileInputRef} onChange={handleImageChange} accept="image/*" className="hidden" />
                
                {error && !showSettings && (
                  <div className="mt-4 bg-red-50 text-red-700 p-4 rounded-2xl border border-red-100 flex items-start gap-3 w-full text-sm animate-in slide-in-from-bottom-2">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    <p className="text-right leading-relaxed font-mono break-words w-full text-xs">{error}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
              <div className={`relative w-full bg-black transition-all duration-700 ease-in-out overflow-hidden ${result ? 'h-56' : 'h-[65vh]'}`}>
                <img src={imageSrc} alt="Selected" className={`w-full h-full object-cover transition-opacity duration-500 ${loading ? 'opacity-50' : 'opacity-100'}`} />
                <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-slate-50 to-transparent"></div>
                
                {loading && (
                  <div className="absolute inset-0">
                    <div className="w-full h-1 bg-indigo-400 shadow-[0_0_20px_rgba(129,140,248,1)] animate-[scan_2s_ease-in-out_infinite]"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="bg-white/95 backdrop-blur-sm px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 border border-slate-100 animate-pulse">
                        <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                        <span className="font-bold text-slate-800 text-sm">جاري الفحص المعمق...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="absolute top-20 left-4 right-4 z-30 flex flex-col gap-2">
                {error && loading === false && !result && (
                  <div className="bg-red-50 text-red-700 p-4 rounded-2xl border border-red-200 shadow-xl flex items-start gap-3 animate-in fade-in zoom-in">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    <p className="text-right leading-relaxed font-mono break-words w-full text-xs">{error}</p>
                  </div>
                )}
                {warning && result && (
                  <div className="bg-amber-50 text-amber-700 p-3 rounded-2xl border border-amber-200 shadow-lg flex items-start gap-3 animate-in fade-in slide-in-from-top-4">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" />
                    <p className="text-right leading-relaxed w-full text-xs font-medium">{warning}</p>
                  </div>
                )}
              </div>

              {result && (
                <div className="relative -mt-10 bg-slate-50 rounded-t-[2rem] px-6 pt-8 pb-8 flex-1 animate-in slide-in-from-bottom-8 duration-500 shadow-[0_-15px_30px_-15px_rgba(0,0,0,0.15)] z-10">
                  <div className="flex items-center gap-4 mb-6">
                    {result.status === 'AI' ? (
                      <div className="bg-red-100 text-red-600 p-4 rounded-2xl shadow-sm">
                        <AlertTriangle className="w-8 h-8" />
                      </div>
                    ) : (
                      <div className="bg-emerald-100 text-emerald-600 p-4 rounded-2xl shadow-sm">
                        <CheckCircle className="w-8 h-8" />
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-slate-500 font-bold tracking-wider mb-1">القرار النهائي</p>
                      <p className={`text-xl font-black tracking-tight ${result.status === 'AI' ? 'text-red-600' : 'text-emerald-600'}`}>
                        {result.status === 'AI' ? 'صورة غير حقيقية (AI)' : 'صورة حقيقية وطبيعية'}
                      </p>
                    </div>
                  </div>

                  <div className="mb-6 bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                    <div className="flex justify-between items-end mb-3">
                      <span className="text-sm font-bold text-slate-700">نسبة الثقة في التحليل</span>
                      <span className="text-xl font-black text-indigo-600">{result.confidence}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-1000 ease-out ${result.status === 'AI' ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${result.confidence}%` }}></div>
                    </div>
                  </div>

                  <div className="bg-indigo-50/70 rounded-2xl p-5 border border-indigo-100/50">
                    <h4 className="font-bold text-indigo-900 mb-3 text-sm flex items-center gap-2">
                      <Info className="w-5 h-5 text-indigo-500" />
                      تقرير الفحص الجنائي:
                    </h4>
                    <p className="text-slate-700 leading-relaxed text-sm whitespace-pre-wrap">
                      {result.analysis}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        {imageSrc && !loading && (
          <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent pt-12 z-20">
            {!result ? (
              <button onClick={analyzeImage} className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl shadow-[0_10px_25px_-8px_rgba(79,70,229,0.6)] active:scale-95 transition-all text-lg flex items-center justify-center gap-2">
                <ScanSearch className="w-6 h-6" />
                تأكيد وبدء الفحص
              </button>
            ) : (
              <button onClick={resetAll} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-4 rounded-2xl shadow-lg active:scale-95 transition-all text-lg flex items-center justify-center gap-2">
                <RefreshCcw className="w-5 h-5" />
                فحص صورة أخرى
              </button>
            )}
          </div>
        )}

        <style dangerouslySetInnerHTML={{__html: `
          @keyframes scan {
            0% { transform: translateY(0); opacity: 1; }
            50% { opacity: 0.6; }
            100% { transform: translateY(65vh); opacity: 1; }
          }
        `}} />
      </div>
    </div>
  );
}
