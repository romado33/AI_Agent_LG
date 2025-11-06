import gradio as gr
from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import CharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain.vectorstores import Chroma
from langchain.chains import RetrievalQA
from langchain_community.llms import HuggingFacePipeline
from transformers import pipeline
import tempfile

def answer_resume_question(pdf, question):
    loader = PyPDFLoader(pdf.name)
    pages = loader.load()
    splitter = CharacterTextSplitter(chunk_size=400, chunk_overlap=50)
    docs = splitter.split_documents(pages)

    embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    db = Chroma.from_documents(docs, embeddings)

    pipe = pipeline("text-generation", model="tiiuae/falcon-7b-instruct", max_new_tokens=256)
    llm = HuggingFacePipeline(pipeline=pipe)

    qa = RetrievalQA.from_chain_type(llm=llm, retriever=db.as_retriever())
    result = qa.invoke(question)
    return result['result']

demo = gr.Interface(
    fn=answer_resume_question,
    inputs=[gr.File(file_types=[".pdf"]), gr.Textbox(label="Ask a question about the resume")],
    outputs="text",
    title="Resume Q&A Assistant",
    description="Upload a resume PDF and ask questions like 'What technologies does this person have experience with?'"
)

demo.launch()
