import os
from openai import OpenAI

def check_bedrock():
    key = os.getenv("AWS_BEARER_TOKEN_BEDROCK")
    region = os.getenv("AWS_DEFAULT_REGION")

    if not key:
        raise RuntimeError("Bedrock API key is missing.")
    if region != "us-east-2":
        raise RuntimeError("Set AWS_DEFAULT_REGION to us-east-2.")

    client = OpenAI(
        api_key=key,
        base_url=(
            "https://bedrock-runtime.us-east-2.amazonaws.com/openai/v1"
        ),
        max_retries=0,
        timeout=60,
    )

    response = client.responses.create(
        model="us.openai.gpt-6.1-sol",
        input="Reply with exactly: Connection successful",
        max_output_tokens=128,
    )

    print(response.output_text or "No text returned.")