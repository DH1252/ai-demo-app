import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

async function main() {
  console.log("Testing API with model:", process.env.AI_MODEL);
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL,
      messages: [{"role":"user","content":"Hello, what is 2+2? Keep it brief."}],
      temperature: 1,
      max_tokens: 100,
      stream: true,
      // Pass the specific kwargs needed by the nvidia models, though optionally required
      extra_body: { "chat_template_kwargs": { "enable_thinking": true } } // Fallback to extra_body if not supported
    });
     
    console.log("Stream starting...\n---");
    for await (const chunk of completion) {
      const reasoning = chunk.choices[0]?.delta?.reasoning_content;
      if (reasoning) {
        process.stdout.write(reasoning);
      }
      process.stdout.write(chunk.choices[0]?.delta?.content || '');
    }
    console.log("\n---\nSuccess!");
  } catch (error) {
    console.error("API Error:", error);
  }
}

main();
