import os
from openai import OpenAI


def check_bedrock():
    key = os.getenv("AWS_BEARER_TOKEN_BEDROCK")
    region = os.getenv("AWS_DEFAULT_REGION")

    if not key:
        raise RuntimeError("Bedrock API key is missing.")
    if not region:
        raise RuntimeError("AWS_DEFAULT_REGION is missing.")

    client = OpenAI(
        api_key=key,
        base_url=f"https://bedrock-runtime.{region}.amazonaws.com/openai/v1",
        max_retries=0,
        timeout=60,
    )

    response = client.chat.completions.create(
        model="mistral.devstral-2-123b",
        messages=[
            {
                "role": "user",
                "content": "Reply with exactly: Connection successful",
            }
        ],
        max_tokens=128,
    )

    print(
        "Model response:",
        response.choices[0].message.content or "(No text returned)",
    )