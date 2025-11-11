import { z } from "zod";
import { toolsWeather } from "./tools.js";

export function toolsTravelEnhanced(factory) {
  const { getWeather } = toolsWeather(factory);

  const planTrip = factory({
    name: "planTrip",
    description: "Plan a complete trip including flights, hotels, weather, and activities",
    schema: z.object({
      destination: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      purpose: z.enum(["interview", "vacation", "business", "relocation"]).default("business"),
      budget: z.number().optional(),
    }),
    impl: async ({ destination, startDate, endDate, purpose, budget }) => {
      // Get weather for destination
      const weather = await getWeather.invoke({ location: destination });

      const plan = {
        destination,
        dates: { start: startDate, end: endDate },
        purpose,
        budget: budget || "Not specified",
        weather: weather.current,
        recommendations: generateRecommendations(purpose, weather),
        checklist: generateChecklist(purpose),
      };

      return plan;
    },
  });

  const findFlights = factory({
    name: "findFlights",
    description: "Find flight options for a trip",
    schema: z.object({
      origin: z.string(),
      destination: z.string(),
      date: z.string(),
      returnDate: z.string().optional(),
    }),
    impl: async ({ origin, destination, date, returnDate }) => {
      // In real implementation, integrate with flight APIs (Amadeus, Skyscanner, etc.)
      return {
        origin,
        destination,
        date,
        returnDate: returnDate || "Not specified",
        options: [
          {
            airline: "Example Airline",
            price: "$500",
            duration: "2h 30m",
            note: "Implement with flight API",
          },
        ],
      };
    },
  });

  const findHotels = factory({
    name: "findHotels",
    description: "Find hotel options for a destination",
    schema: z.object({
      destination: z.string(),
      checkIn: z.string(),
      checkOut: z.string(),
      budget: z.number().optional(),
    }),
    impl: async ({ destination, checkIn, checkOut, budget }) => {
      // In real implementation, integrate with hotel APIs (Booking.com, Expedia, etc.)
      return {
        destination,
        dates: { checkIn, checkOut },
        budget: budget || "Not specified",
        options: [
          {
            name: "Example Hotel",
            price: "$100/night",
            rating: 4.5,
            note: "Implement with hotel API",
          },
        ],
      };
    },
  });

  const getTravelRecommendations = factory({
    name: "getTravelRecommendations",
    description: "Get travel recommendations based on purpose and destination",
    schema: z.object({
      destination: z.string(),
      purpose: z.enum(["interview", "vacation", "business", "relocation"]),
    }),
    impl: async ({ destination, purpose }) => {
      const weather = await getWeather.invoke({ location: destination });
      return {
        destination,
        purpose,
        weatherAdvice: getWeatherAdvice(weather),
        packingList: getPackingList(purpose, weather),
        tips: getTravelTips(purpose),
      };
    },
  });

  return {
    getWeather,
    planTrip,
    findFlights,
    findHotels,
    getTravelRecommendations,
  };
}

function generateRecommendations(purpose, weather) {
  const recommendations = [];
  if (purpose === "interview") {
    recommendations.push("Arrive a day early to adjust to timezone");
    recommendations.push("Research company location and transportation");
    recommendations.push("Prepare questions about the role and company");
  }
  if (weather.current?.temperature_2m < 10) {
    recommendations.push("Pack warm clothing");
  }
  if (weather.current?.precipitation > 0) {
    recommendations.push("Bring an umbrella");
  }
  return recommendations;
}

function generateChecklist(purpose) {
  const base = ["Passport/ID", "Tickets", "Hotel confirmation", "Travel insurance"];
  if (purpose === "interview") {
    return [
      ...base,
      "Resume copies",
      "Portfolio",
      "Interview confirmation",
      "Company research notes",
      "Questions for interviewer",
    ];
  }
  return base;
}

function getWeatherAdvice(weather) {
  const temp = weather.current?.temperature_2m || 20;
  if (temp < 10) {
    return "Cold weather - pack warm clothes";
  }
  if (temp > 25) {
    return "Warm weather - pack light clothing";
  }
  return "Moderate weather - pack layers";
}

function getPackingList(purpose, weather) {
  const base = ["Clothing", "Toiletries", "Electronics", "Documents"];
  if (purpose === "interview") {
    base.push("Professional attire", "Portfolio", "Resume");
  }
  if (weather.current?.precipitation > 0) {
    base.push("Umbrella", "Waterproof jacket");
  }
  return base;
}

function getTravelTips(purpose) {
  if (purpose === "interview") {
    return [
      "Arrive 15 minutes early",
      "Research the company thoroughly",
      "Prepare questions to ask",
      "Follow up with thank you email",
    ];
  }
  return ["Check local customs", "Keep important documents safe", "Stay hydrated"];
}

