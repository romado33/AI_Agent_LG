# --- Install needed libraries ---
!pip install -U langchain langchain-community langchain-huggingface transformers sentence-transformers chromadb pypdf gradio

from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import CharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain.vectorstores import Chroma
from langchain.chains import RetrievalQA
from langchain_community.llms import HuggingFacePipeline
from transformers import pipeline
import tempfile
import os

# Load PDF
loader = PyPDFLoader("Rob Dods - 2025.pdf")
pages = loader.load()

# Split into manageable chunks
splitter = CharacterTextSplitter(chunk_size=400, chunk_overlap=50)
docs = splitter.split_documents(pages)

# Create embeddings
embedding_model = "sentence-transformers/all-MiniLM-L6-v2"
embeddings = HuggingFaceEmbeddings(model_name=embedding_model)
persist_dir = tempfile.mkdtemp()
db = Chroma.from_documents(docs, embeddings, persist_directory=persist_dir)

# Build LLM pipeline
pipe = pipeline("text-generation", model="tiiuae/falcon-7b-instruct", device_map="auto", max_new_tokens=256)
llm = HuggingFacePipeline(pipeline=pipe)

# QA Chain
qa = RetrievalQA.from_chain_type(llm=llm, retriever=db.as_retriever())

# Questions
questions = [
    "What technologies does this person have experience with?",
    "What are 3 unique career highlights from this resume?",
    "What industries has this person worked in?",
]

# Ask & display
for q in questions:
    response = qa.invoke(q)
    print(f"\n❓ {q}\n💬 {response['result']}")

