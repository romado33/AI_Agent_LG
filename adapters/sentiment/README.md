# 🧠 FeelMap – Understand Emotions in Writing

FeelMap is a free, web-based tool that helps users understand the emotions hidden in written language. Whether you're a student, writer, educator, neurodiverse individual, or just curious — FeelMap gives you clear, instant feedback on emotional tone.

---

## ✨ What It Does

- 📥 Enter any sentence or paragraph
- 📊 See a color-coded chart of emotions detected (like Joy, Sadness, Anger, etc.)
- 🏆 Highlights the top 3 most prominent emotions
- 🤖 Choose between 3 analysis modes:
  - **Simple** (7 core emotions)
  - **Advanced** (28 nuanced emotions)
  - **GPT AI** (OpenAI-powered, human-like insight)
- 📂 Upload text files for analysis or type directly
- ⬇️ Download detailed emotion scores as CSV

---

## 💡 Why Use FeelMap?

- Make your writing more emotionally aware
- Get help interpreting tone when it's unclear
- Understand how mixed feelings are expressed in language
- Great for reflection, communication, and emotional literacy

---

## 🌐 Try It Now

> [FeelMap Live App](https://feelmap-nseyfgoyvrstb4nkfkfn32.streamlit.app/)
*(If the app isn’t live, you can clone and run it locally — see below)*


---

## 🛠️ Run Locally (Optional for Developers)

```bash
git clone https://github.com/yourusername/feelmap.git
cd feelmap
pip install -r requirements.txt
streamlit run app.py
```

For GPT-powered mode, add your OpenAI API key in `.streamlit/secrets.toml` like this:

```toml
OPENAI_API_KEY = "sk-..."
```

---

## 🧠 Credits

Built with ❤️ by Rob Dods using [Streamlit](https://streamlit.io), [Hugging Face Transformers](https://huggingface.co), and [OpenAI](https://openai.com).

---

## 🔐 Privacy Note

All emotion processing happens client-side or securely via API. No input data is stored or shared.

---

## 📬 Feedback

Click “⚠️ Was this emotion incorrect?” in the app to leave feedback and help improve FeelMap.
