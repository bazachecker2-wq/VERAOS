
export const queryOpenRouter = async (messages: any[]) => {
  // Use specific OpenRouter key if available, otherwise try the main key (often they are separate in prod)
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.API_KEY; 
  
  if (!apiKey) {
      console.warn("No API Key available for OpenRouter Fallback");
      return "Система резервного копирования недоступна. Отсутствует ключ API.";
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": window.location.origin, 
        "X-Title": "AI Vision HUD"
      },
      body: JSON.stringify({
        "model": "openai/gpt-4o", // High intelligence fallback
        "messages": [
            {
                "role": "system",
                "content": "Ты — резервная система ИИ для тактического шлема. Твоя задача — кратко и четко отвечать на запросы оператора. Стиль: военный, лаконичный, информативный. Ты не видишь видео, только получаешь текст от оператора."
            },
            ...messages
        ],
        "max_tokens": 150
      })
    });

    if (!response.ok) {
        throw new Error(`OpenRouter API Error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Нет данных.";
  } catch (error) {
    console.error("Fallback API Error:", error);
    return "Ошибка соединения с резервным каналом.";
  }
};
