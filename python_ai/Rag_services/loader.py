import os
from typing import List, Any, Dict
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import PyPDFLoader


class EventDocumentLoader:
    def __init__(self, chunk_size: int = 600, chunk_overlap: int = 80):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            separators=["\n\n", "\n", "• ", "- ", ". ", " ", ""]
        )

    def load_from_dict(self, event: Dict[str, Any]) -> List[Document]:
        event_id = str(event.get("_id") or event.get("id", ""))
        title = event.get("title", "Untitled Event")
        base_metadata = {
            "event_id": event_id,
            "event_title": title,
            "collegename": event.get("collegename") or event.get("college_name", "")
        }

        raw_docs: List[Document] = []
        team_size = event.get("teamSize") or {}
        team_info = (
            f"Individual ({team_size.get('min', 1)})"
            if team_size.get("max", 1) == 1
            else f"Team of {team_size.get('min', 1)} to {team_size.get('max', 1)} members"
        )

        event_content = (
            f"Event: {title}\n"
            f"Category: {event.get('category', 'N/A')}\n"
            f"Department: {event.get('department', 'N/A')}\n"
            f"Description: {event.get('description', '')}\n"
            f"Venue: {event.get('venue', 'TBD')}\n"
            f"Participation: {event.get('participationType', 'Individual')} ({team_info})\n"
            f"Registration Fee: Rs. {event.get('registrationFee', 0)}\n"
            f"Timeline: {event.get('startDate', 'TBD')} to {event.get('endDate', 'TBD')}"
        )
        raw_docs.append(Document(page_content=event_content, metadata={**base_metadata, "doc_type": "overview"}))

        eligibility_info = (
            f"Event: {title}\n"
            f"Eligibility: {event.get('eligibility', 'Open to all students')}\n"
            f"Registration Instructions: {event.get('registrationInstructions', 'N/A')}\n"
            f"Registration Window: {event.get('registrationStartDate', 'N/A')} to {event.get('registrationEndDate', 'N/A')}"
        )
        raw_docs.append(Document(page_content=eligibility_info, metadata={**base_metadata, "doc_type": "eligibility"}))

        rules = event.get("rules", [])
        if rules:
            formatted_rules = "\n".join([f"{i+1}. {rule}" for i, rule in enumerate(rules)])
            rules_content = (
                f"Rules and Regulations for {title}:\n"
                f"{formatted_rules}\n"
                f"Terms: {event.get('termsAndConditions') or event.get('termAndCondition', 'Standard campus regulations apply.')}"
            )
            raw_docs.append(Document(page_content=rules_content, metadata={**base_metadata, "doc_type": "rules"}))

        cert = event.get("certificate", {})
        cert_info = f"Certificate Provided: {'Yes' if cert.get('isProvided', True) else 'No'} (Type: {cert.get('type', 'Participation')})"

        contact_content = (
            f"Event: {title}\n"
            f"{cert_info}\n"
            f"Contact Email: {event.get('contactEmail', 'N/A')}\n"
            f"Contact Phone: {event.get('contactPhone', 'N/A')}"
        )
        raw_docs.append(Document(page_content=contact_content, metadata={**base_metadata, "doc_type": "contact_and_certs"}))

        return self.splitter.split_documents(raw_docs)

    def load_from_pdf(self, file_path: str, event_id: str, title: str = "", college_name: str = "") -> List[Document]:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"PDF file does not exist: {file_path}")

        loader = PyPDFLoader(file_path)
        pages = loader.load()

        for page in pages:
            page.metadata.update({
                "event_id": str(event_id),
                "event_title": title,
                "college_name": college_name,
                "doc_type": "pdf_guideline",
                "source_file": os.path.basename(file_path)
            })

        return self.splitter.split_documents(pages)

    def load_from_text(self, text: str, event_id: str, title: str = "", doc_type: str = "custom") -> List[Document]:
        chunks = self.splitter.split_text(text)
        return [
            Document(
                page_content=chunk,
                metadata={"event_id": str(event_id), "event_title": title, "doc_type": doc_type}
            )
            for chunk in chunks
        ]
